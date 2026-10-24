from __future__ import annotations

import io
import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr
from sqlalchemy import func, select

from emc_api.models import (
    Artifact,
    EvidenceFile,
    ReviewJob,
    VerificationReview,
    VerificationSubmission,
)
from emc_api.services import deliverable_review as reader
from emc_api.services import review_queue as queue
from emc_api.services.agent_runtime import LEVEL_GUIDES
from emc_api.timeutil import utcnow


def submit(client, make_player, login_as, *, kind="business_plan", file=None):
    login_as(make_player())
    project = client.post(
        "/api/projects",
        json={"name": "我的小生意", "platform": "xiaohongshu", "category": "家居收纳"},
    ).json()
    art = client.post(
        "/api/artifacts",
        json={
            "project_id": project["id"],
            "artifact_type": kind,
            "schema_version": 1,
            "title": "我的真实成果",
            "content": {
                "summary": (
                    "我想帮助租房上班族整理小桌面，先比较免打孔收纳盒与理线夹。"
                    "预算两千，每周十小时，先访谈三位朋友，供货与需求仍待验证。"
                )
            },
        },
    ).json()
    evidence = []
    if file:
        uploaded = client.post(
            "/api/evidence", files={"file": ("evidence.png", file, "image/png")}
        ).json()
        evidence = [uploaded["id"]]
    payload = {
        "artifact_id": art["id"],
        "artifact_version": art["version"],
        "evidence_ids": evidence,
    }
    response = client.post(
        "/api/verifications", json=payload, headers={"Idempotency-Key": "queue-case"}
    )
    assert response.status_code == 201, response.text
    return response.json(), payload


def report(level="L1", status="approved"):
    return {
        "status": status,
        "confidence": 0.9,
        "summary": "目标和依据清楚，先用小规模实践验证需求。",
        "checks": [
            {"criterion": c, "met": status == "approved", "evidence": "成果中的具体说明"}
            for c in LEVEL_GUIDES[level]["checklist"]
        ],
        "issues": [] if status == "approved" else ["补充本关的核心成果"],
        "suggestions": ["先小规模验证"],
    }


def test_enqueue_is_atomic_and_idempotent(client, make_player, login_as, db_session):
    sub, payload = submit(client, make_player, login_as)
    again = client.post(
        "/api/verifications", json=payload, headers={"Idempotency-Key": "queue-case"}
    )
    assert again.status_code == 201
    assert again.json()["id"] == sub["id"]
    assert db_session.scalar(select(func.count()).select_from(ReviewJob)) == 1
    assert db_session.get(ReviewJob, sub["id"]).snapshot_sha256 == sub["snapshot_sha256"]


@pytest.mark.parametrize(
    "status", ["approved", "needs_revision", "insufficient_evidence", "manual_review"]
)
def test_worker_writes_real_history_once(
    status, client, make_player, login_as, database, db_session, settings, monkeypatch
):
    sub, _ = submit(client, make_player, login_as)
    assert sub["status"] == "approved"
    monkeypatch.setattr(queue, "review_submission", lambda *a, **kw: report(status=status))
    assert queue.run_one(database, settings)
    assert not queue.run_one(database, settings)
    from emc_api.services.agent_runtime import get_latest_ai_review

    assert get_latest_ai_review(db_session, sub["id"])["summary"] == report()["summary"]
    db_session.expire_all()
    assert db_session.get(VerificationSubmission, sub["id"]).status == "approved"
    assert db_session.get(Artifact, sub["artifact_id"]).status == "approved"
    assert db_session.get(ReviewJob, sub["id"]).report["status"] == status
    assert db_session.scalar(select(func.count()).select_from(VerificationReview)) == 0


def test_outage_retries_without_failing_player(
    client, make_player, login_as, database, db_session, settings, monkeypatch
):
    sub, _ = submit(client, make_player, login_as)

    def unavailable(*a, **kw):
        raise reader.ReviewUnavailable("provider_or_schema_error")

    monkeypatch.setattr(queue, "review_submission", unavailable)
    for attempt in range(queue.MAX_ATTEMPTS):
        assert queue.run_one(database, settings)
        db_session.expire_all()
        job = db_session.get(ReviewJob, sub["id"])
        assert job.attempts == attempt + 1
        job.next_attempt_at = utcnow() - timedelta(seconds=1)
        db_session.commit()
    assert job.status == "completed"
    assert db_session.get(VerificationSubmission, sub["id"]).status == "approved"
    assert db_session.scalar(select(func.count()).select_from(VerificationReview)) == 0


def test_lease_recovery_and_exclusion(client, make_player, login_as, database, db_session):
    sub, _ = submit(client, make_player, login_as)
    first = queue.claim(db_session)
    with database.sessionmaker() as other:
        assert queue.claim(other) is None
    job = db_session.get(ReviewJob, sub["id"])
    job.lease_until = utcnow() - timedelta(seconds=1)
    db_session.commit()
    second = queue.claim(db_session)
    assert first[0] == second[0] and first[1] != second[1]


def test_manual_decision_wins_race(client, make_player, login_as, database, settings, monkeypatch):
    sub, _ = submit(client, make_player, login_as)

    def decide(*args, **kw):
        with database.sessionmaker() as db:
            db.get(VerificationSubmission, sub["id"]).status = "rejected"
            db.commit()
        return report()

    monkeypatch.setattr(queue, "review_submission", decide)
    queue.run_one(database, settings)
    with database.sessionmaker() as db:
        assert db.get(VerificationSubmission, sub["id"]).status == "rejected"
        assert db.get(ReviewJob, sub["id"]).last_error == "superseded"
        assert db.scalar(select(func.count()).select_from(VerificationReview)) == 0


def test_new_revision_is_never_overwritten(
    client, make_player, login_as, database, settings, monkeypatch
):
    sub, _ = submit(client, make_player, login_as)

    def revise(*args, **kw):
        with database.sessionmaker() as db:
            db.get(Artifact, sub["artifact_id"]).current_revision = 2
            db.commit()
        return report()

    monkeypatch.setattr(queue, "review_submission", revise)
    queue.run_one(database, settings)
    with database.sessionmaker() as db:
        assert db.get(VerificationSubmission, sub["id"]).status == "approved"
        assert db.get(ReviewJob, sub["id"]).last_error == "superseded"


def test_real_image_bytes_and_strict_rubric(
    client, make_player, login_as, db_session, settings, monkeypatch
):
    output = io.BytesIO()
    Image.new("RGB", (120, 80), "green").save(output, format="PNG")
    sub, _ = submit(client, make_player, login_as, kind="asset_pack", file=output.getvalue())
    settings.ai_api_key = SecretStr("unit-test-key")
    sent = []
    payload = report("L3")

    class Provider:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            sent.append(kwargs["json"])
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={"choices": [{"message": {"content": json.dumps(payload)}}]},
            )

    monkeypatch.setattr(reader, "httpx", SimpleNamespace(Client=Provider, Timeout=httpx.Timeout))
    current = db_session.get(VerificationSubmission, sub["id"])
    result = reader.review_submission(db_session, settings, current)
    assert result["status"] == "approved"
    parts = sent[0]["messages"][-1]["content"]
    assert any(
        p.get("type") == "image_url" and p["image_url"]["url"].startswith("data:image/jpeg;base64,")
        for p in parts
    )
    payload["checks"][0]["met"] = False
    with pytest.raises(reader.ReviewUnavailable, match="contradictory_approval"):
        reader.review_submission(db_session, settings, current)
    evidence = db_session.scalar(select(EvidenceFile))
    evidence.sha256 = "0" * 64
    db_session.flush()
    with pytest.raises(reader.ReviewUnavailable, match="evidence_integrity"):
        reader.review_submission(db_session, settings, current)


@pytest.mark.parametrize("state", ["leased", "waiting_manual"])
def test_removed_human_review_cannot_override_approval(
    state, client, make_player, login_as, db_session
):
    sub, _ = submit(client, make_player, login_as)
    job = db_session.get(ReviewJob, sub["id"])
    job.status = state
    db_session.commit()
    login_as(make_player(), reviewer=True)
    response = client.post(
        "/api/admin/verifications/" + sub["id"] + "/review",
        json={"decision": "rejected", "reason": "人工驳回"},
    )
    assert response.status_code == 404
    db_session.expire_all()
    assert db_session.get(VerificationSubmission, sub["id"]).status == "approved"
