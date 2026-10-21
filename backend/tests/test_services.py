"""幂等、审计、分页、ID、Galera 死锁重试。"""

from __future__ import annotations

from datetime import timedelta

import pymysql
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from emc_api import ids
from emc_api.db import is_duplicate_key_error, is_retryable_error, with_retry
from emc_api.models import (
    AppendOnlyViolation,
    AuditEvent,
    BusinessProject,
    IdempotencyRecord,
    Player,
)
from emc_api.services.audit import record_audit
from emc_api.services.idempotency import purge_expired_idempotency_records
from emc_api.timeutil import utcnow

from .support import router as support_router


@pytest.fixture
def app(app_factory) -> FastAPI:
    return app_factory(support_router)


def count(db: Session, model) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model))


# ---------------------------------------------------------------- ID


def test_new_id_format() -> None:
    seen = set()
    for prefix in ("ply", "prj", "art", "ver", "evd", "rev"):
        value = ids.new_id(prefix)
        assert len(value) == ids.ID_LENGTH
        assert ids.has_prefix(value, prefix)
        assert not ids.has_prefix(value, "zzz")
        seen.add(value)
    assert len(seen) == 6
    assert not ids.has_prefix("ply_" + "A" * 26, "ply")
    with pytest.raises(ValueError):
        ids.new_id("bad")


# ---------------------------------------------------------------- 幂等


def test_idempotency_same_body_replays(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    headers = {"Idempotency-Key": "create-1"}
    first = client.post("/api/_t/things", json={"name": "店铺"}, headers=headers)
    assert first.status_code == 201
    assert "Idempotency-Replayed" not in first.headers
    second = client.post("/api/_t/things", json={"name": "店铺"}, headers=headers)
    assert second.status_code == 201
    assert second.headers["Idempotency-Replayed"] == "true"
    assert second.json() == first.json()
    assert count(db_session, BusinessProject) == 1
    assert count(db_session, AuditEvent) == 1


def test_idempotency_different_body_is_422(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    headers = {"Idempotency-Key": "create-2"}
    assert client.post("/api/_t/things", json={"name": "A"}, headers=headers).status_code == 201
    resp = client.post("/api/_t/things", json={"name": "B"}, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "idempotency_key_reuse"
    assert count(db_session, BusinessProject) == 1


def test_idempotency_scoped_by_endpoint_and_player(
    client, make_client, make_player, login_as, db_session
) -> None:
    login_as(make_player())
    headers = {"Idempotency-Key": "same-key"}
    a = client.post("/api/_t/things", json={"name": "A"}, headers=headers)
    b = client.post("/api/_t/other-things", json={"name": "A"}, headers=headers)
    other = make_client()
    login_as(make_player(), test_client=other)
    c = other.post("/api/_t/things", json={"name": "A"}, headers=headers)
    assert {a.status_code, b.status_code, c.status_code} == {201}
    assert len({a.json()["id"], b.json()["id"], c.json()["id"]}) == 3
    assert count(db_session, IdempotencyRecord) == 3


def test_idempotency_without_key(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    for _ in range(2):
        assert client.post("/api/_t/things", json={"name": "A"}).status_code == 201
    assert count(db_session, BusinessProject) == 2
    assert count(db_session, IdempotencyRecord) == 0


def test_idempotency_failed_request_not_recorded(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    headers = {"Idempotency-Key": "fail-1"}
    resp = client.post("/api/_t/things", json={"name": "fail"}, headers=headers)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "invalid_state"
    assert count(db_session, IdempotencyRecord) == 0
    assert count(db_session, AuditEvent) == 0


def test_idempotency_expired_record_reexecutes(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    headers = {"Idempotency-Key": "old"}
    first = client.post("/api/_t/things", json={"name": "A"}, headers=headers)
    db_session.execute(update(IdempotencyRecord).values(expires_at=utcnow() - timedelta(seconds=1)))
    db_session.commit()
    second = client.post("/api/_t/things", json={"name": "B"}, headers=headers)
    assert second.status_code == 201 and second.json()["id"] != first.json()["id"]
    assert "Idempotency-Replayed" not in second.headers


@pytest.mark.parametrize("key", ["", "x" * 129, "has space", "中文"])
def test_idempotency_key_format(client, make_player, login_as, key: str) -> None:
    login_as(make_player())
    resp = client.post(
        "/api/_t/things",
        json={"name": "A"},
        headers={"Idempotency-Key": key.encode("utf-8")},
    )
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "validation_error"


def test_idempotency_record_retention(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    client.post("/api/_t/things", json={"name": "A"}, headers={"Idempotency-Key": "k"})
    db_session.expire_all()
    record = db_session.scalars(select(IdempotencyRecord)).one()
    assert record.endpoint == "POST /api/_t/things"
    assert record.response_status == 201
    assert record.expires_at - record.created_at == timedelta(hours=24)


def test_purge_expired_idempotency_records(client, make_player, login_as, db_session) -> None:
    login_as(make_player())
    for key in ("a", "b", "c"):
        client.post("/api/_t/things", json={"name": key}, headers={"Idempotency-Key": key})
    db_session.execute(
        update(IdempotencyRecord)
        .where(IdempotencyRecord.idem_key.in_(["a", "b"]))
        .values(expires_at=utcnow() - timedelta(minutes=1))
    )
    db_session.commit()
    assert purge_expired_idempotency_records(db_session) == 2
    db_session.commit()
    assert count(db_session, IdempotencyRecord) == 1


# ---------------------------------------------------------------- 审计


def test_audit_event_written_with_request_id(client, make_player, login_as, db_session) -> None:
    player = make_player()
    login_as(player)
    resp = client.post("/api/_t/things", json={"name": "店铺"})
    db_session.expire_all()
    event = db_session.scalars(select(AuditEvent)).one()
    assert event.action == "project.create"
    assert event.actor_player_id == player.id
    assert event.target_type == "project" and event.target_id == resp.json()["id"]
    assert event.request_id == resp.headers["X-Request-ID"]
    assert event.details == {"name": "店铺"}


def test_audit_is_append_only(db_session) -> None:
    record_audit(db_session, "test.event", details={"a": 1})
    db_session.commit()
    event = db_session.scalars(select(AuditEvent)).one()
    event.action = "changed"
    with pytest.raises(AppendOnlyViolation):
        db_session.flush()
    db_session.rollback()
    db_session.delete(db_session.scalars(select(AuditEvent)).one())
    with pytest.raises(AppendOnlyViolation):
        db_session.flush()
    db_session.rollback()


# ---------------------------------------------------------------- 分页


def test_pagination(client, make_player, login_as) -> None:
    login_as(make_player())
    created = [client.post("/api/_t/things", json={"name": f"p{i}"}).json()["id"] for i in range(5)]
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        body = client.get("/api/_t/things", params=params).json()
        assert set(body) == {"items", "next_cursor"}
        seen += [item["id"] for item in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert pages == 3
    assert seen == list(reversed(created))


def test_pagination_only_own_items(client, make_client, make_player, login_as) -> None:
    login_as(make_player())
    client.post("/api/_t/things", json={"name": "mine"})
    other = make_client()
    login_as(make_player(), test_client=other)
    assert other.get("/api/_t/things").json() == {"items": [], "next_cursor": None}


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 101}, {"limit": "x"}, {"cursor": "not-a-cursor"}]
)
def test_pagination_invalid_params(client, make_player, login_as, params) -> None:
    login_as(make_player())
    resp = client.get("/api/_t/things", params=params)
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "validation_error"


# ---------------------------------------------------------------- 死锁重试


def simulated_error(errno: int, cls=OperationalError):
    return cls("COMMIT", {}, pymysql.err.OperationalError(errno, "simulated"))


def test_error_classifiers() -> None:
    assert is_retryable_error(simulated_error(1213))
    assert is_retryable_error(simulated_error(1020))
    assert not is_retryable_error(simulated_error(1062))
    assert not is_retryable_error(RuntimeError("x"))
    assert is_duplicate_key_error(simulated_error(1062, IntegrityError))


def test_with_retry_retries_deadlock_and_rolls_back(db_session) -> None:
    calls = []

    def work(s: Session) -> str:
        calls.append(1)
        player = Player(
            id=ids.new_id(ids.PLAYER),
            acos_sub=f"retry-{len(calls)}",
            display_name="x",
            created_at=utcnow(),
        )
        s.add(player)
        s.flush()
        if len(calls) < 3:
            raise simulated_error(1213)  # Galera 提交时的认证冲突
        return player.acos_sub

    assert with_retry(db_session, work, base_delay=0) == "retry-3"
    assert len(calls) == 3
    subs = db_session.scalars(select(Player.acos_sub)).all()
    assert subs == ["retry-3"]  # 前两次尝试已回滚


def test_with_retry_gives_up(db_session) -> None:
    calls = []

    def work(s: Session) -> None:
        calls.append(1)
        raise simulated_error(1213)

    with pytest.raises(OperationalError):
        with_retry(db_session, work, attempts=3, base_delay=0)
    assert len(calls) == 3


def test_with_retry_does_not_retry_other_errors(db_session) -> None:
    calls = []

    def work(s: Session) -> None:
        calls.append(1)
        raise simulated_error(1062, IntegrityError)

    with pytest.raises(IntegrityError):
        with_retry(db_session, work, base_delay=0)
    assert len(calls) == 1


def test_with_retry_commit_failure_is_retried(db_session, monkeypatch) -> None:
    real_commit = db_session.commit
    state = {"commits": 0}

    def flaky_commit() -> None:
        state["commits"] += 1
        if state["commits"] == 1:
            db_session.rollback()
            raise simulated_error(1213)
        real_commit()

    monkeypatch.setattr(db_session, "commit", flaky_commit)

    def work(s: Session) -> None:
        s.add(
            Player(
                id=ids.new_id(ids.PLAYER),
                acos_sub="commit-retry",
                display_name="x",
                created_at=utcnow(),
            )
        )

    with_retry(db_session, work, base_delay=0)
    assert state["commits"] == 2
    assert db_session.scalars(select(Player.acos_sub)).all() == ["commit-retry"]
