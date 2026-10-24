"""Regressions for #88–#90: accounting, lossless drafts and project-scoped feedback."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from emc_api import ids
from emc_api.models import Artifact, ArtifactRevision, VerificationSubmission
from emc_api.services import agent_runtime as runtime
from emc_api.timeutil import utcnow


@pytest.mark.parametrize(
    "message,cost,profit,roi,breakdown",
    [
        (
            "帮我算利润：售价100，拿货成本40，快递包材8，佣金5%",
            53,
            47,
            2.13,
            {"拿货成本": 40, "快递包材合计": 8, "平台费用": 5},
        ),
        (
            "帮我算利润：售价100元，拿货成本40元，运费成本8元，包材成本2元",
            50,
            50,
            2,
            {"拿货成本": 40, "运费": 8, "包材": 2},
        ),
        (
            "算利润：售价100，拿货40，运费8包材2，运费改为6，佣金5%佣金改为3元",
            51,
            49,
            2.04,
            {"拿货成本": 40, "运费": 6, "包材": 2, "平台费用": 3},
        ),
        ("算利润：售价100综合成本60运费8包材2", 60, 40, 2.5, {"综合成本": 60}),
    ],
)
def test_accounting_api(client, monkeypatch, message, cost, profit, roi, breakdown):
    def no_model(*args, **kwargs):
        pytest.fail("Labelled arithmetic must not depend on the model")

    monkeypatch.setattr(runtime.AgentProviderAdapter, "complete_json_or_text", no_model)
    response = client.post("/api/agent/chat", json={"message": message})
    assert response.status_code == 200
    data = response.json()
    calc = data["roi_calculation"]
    assert data["provider"] == "verified_calculation"
    assert calc["cost_breakdown"] == breakdown
    assert calc["total_cost"] == cost
    assert calc["unit_profit"] == profit
    assert calc["breakeven_roi"] == roi
    assert f"{cost:.2f} 元" in data["reply"]
    assert "不是净利润" in data["reply"]
    if "综合成本" not in breakdown:
        assert "广告费" in calc["missing_costs"]


def project(client, name):
    response = client.post("/api/projects", json={"name": name, "platform": "xiaohongshu"})
    assert response.status_code == 201
    return response.json()["id"]


def chat(client, project_id, message, **extra):
    return client.post(
        "/api/agent/chat",
        json={
            "message": message,
            "level_id": "L1",
            "session_id": project_id,
            "client_context": {"active_project": {"id": project_id}},
            **extra,
        },
    )


def revision(db, artifact_id, number=None):
    db.expire_all()
    art = db.get(Artifact, artifact_id)
    return db.get(ArtifactRevision, (artifact_id, number or art.current_revision)).content


@pytest.mark.parametrize("save_flag", [False, True])
def test_existing_draft_is_preserved(client, make_player, login_as, db_session, save_flag):
    owner = make_player()
    login_as(owner)
    selected = project(client, "完整方案")
    original = {
        "summary": "原有完整经营方案",
        "budget": 2000,
        "planning_report": "方案正文：商品、客群、预算、渠道均已确认。",
        "evidence_groups": [{"evidence_ids": ["evd_example"]}],
    }
    saved = runtime.tool_save_business_draft(
        db_session, owner.id, level_id="L1", project_id=selected, content=original
    )
    db_session.commit()
    response = chat(client, selected, "把刚才的方案保存草稿", save_as_draft=save_flag)
    assert response.status_code == 200
    result = response.json()["saved_artifact"]
    assert result["id"] == saved["artifact_id"]
    assert result["revision"] == 2
    assert revision(db_session, result["id"]) == original
    assert revision(db_session, result["id"], 1) == original


def test_empty_save_does_not_create_placeholder(client, make_player, login_as, db_session):
    login_as(make_player())
    selected = project(client, "空项目")
    response = chat(client, selected, "把刚才的方案保存草稿", save_as_draft=True)
    assert response.status_code == 200
    assert response.json()["saved_artifact"] is None
    assert "没有可保存" in response.json()["reply"]
    assert db_session.scalars(select(Artifact)).all() == []
    denied = client.post(
        "/api/agent/tools/execute",
        json={"tool_name": "save_business_draft", "arguments": {"level_id": "L1"}},
    )
    assert denied.status_code == 422


def test_partial_update_keeps_budget_evidence_and_history(
    client, make_player, login_as, db_session
):
    owner = make_player()
    login_as(owner)
    selected = project(client, "更新方案")
    original = {
        "summary": "原文",
        "budget": 2000,
        "evidence_groups": [{"evidence_ids": ["evd_example"]}],
    }
    saved = runtime.tool_save_business_draft(
        db_session, owner.id, level_id="L1", project_id=selected, content=original
    )
    updated = runtime.tool_save_business_draft(
        db_session,
        owner.id,
        level_id="L1",
        project_id=selected,
        content={"planning_report": "实际的新方案正文"},
    )
    db_session.commit()
    assert updated["artifact_id"] == saved["artifact_id"]
    assert revision(db_session, saved["artifact_id"]) == {
        **original,
        "planning_report": "实际的新方案正文",
    }
    assert revision(db_session, saved["artifact_id"], 1) == original


@pytest.mark.parametrize("same_turn", [False, True])
def test_generated_plan_saved_with_project_and_level_isolation(
    client, make_player, login_as, monkeypatch, db_session, same_turn
):
    login_as(make_player())
    selected = project(client, "方案B")
    other = project(client, "方案A")
    plan = (
        "# 经营方案\n"
        + "商品：收纳盒。客群：小户型家庭。预算：2000元。渠道：小红书。证据待补充。" * 4
    )
    monkeypatch.setattr(
        runtime.AgentProviderAdapter,
        "complete_json_or_text",
        lambda *a, **kw: (plan, {"provider": "ai_gateway_live"}),
    )
    if same_turn:
        response = chat(client, selected, "生成草稿：请整理经营方案")
    else:
        assert chat(client, selected, "请整理经营方案").status_code == 200
        # Same account, different project or level cannot consume B's plan.
        assert chat(client, other, "保存草稿").json()["saved_artifact"] is None
        assert chat(client, selected, "保存草稿", level_id="L2").json()["saved_artifact"] is None
        response = chat(client, selected, "把刚才的方案保存草稿")
    assert response.status_code == 200
    saved = response.json()["saved_artifact"]
    assert saved is not None
    assert revision(db_session, saved["id"])["planning_report"] == plan
    assert db_session.get(Artifact, saved["id"]).project_id == selected


@pytest.mark.parametrize("newer", ["A", "B"])
def test_feedback_scopes_automatic_and_tool_queries(
    client, make_player, login_as, db_session, monkeypatch, newer
):
    owner = make_player()
    login_as(owner)
    projects = {name: project(client, name) for name in ("A", "B", "empty")}
    submissions = {}
    for name in ("A", "B"):
        draft = runtime.tool_save_business_draft(
            db_session,
            owner.id,
            level_id="L1",
            project_id=projects[name],
            content={"summary": name},
        )
        sub = VerificationSubmission(
            id=ids.new_id(ids.VERIFICATION),
            artifact_id=draft["artifact_id"],
            owner_id=owner.id,
            artifact_revision=1,
            snapshot={},
            snapshot_sha256="0" * 64,
            status="approved",
            note=f"仅属于{name}",
            created_at=utcnow() + timedelta(seconds=10 if name == newer else 0),
        )
        db_session.add(sub)
        submissions[name] = sub.id
    db_session.commit()
    captured = {}

    def complete(*args, **kwargs):
        captured.update(kwargs["context"])
        return None, {"provider": "local_copilot_fallback"}

    monkeypatch.setattr(runtime.AgentProviderAdapter, "complete_json_or_text", complete)
    for name in ("B", "A", "empty"):
        response = chat(client, projects[name], "请看当前项目的认证反馈", level_id="L2")
        assert response.status_code == 200
        review = captured["review"]
        if name == "empty":
            assert review == {"found": False, "submission": None}
        else:
            assert review["submission"]["id"] == submissions[name]
            assert submissions[{"A": "B", "B": "A"}[name]] not in response.json()["reply"]
        tool = client.post(
            "/api/agent/tools/execute",
            json={
                "tool_name": "get_review_feedback",
                "arguments": {},
                "client_context": {"active_project": {"id": projects[name]}},
            },
        )
        assert tool.status_code == 200
        assert tool.json()["result"] == review
    explicit = client.post(
        "/api/agent/tools/execute",
        json={
            "tool_name": "get_review_feedback",
            "arguments": {"submission_id": submissions["B"]},
            "client_context": {"active_project": {"id": projects["B"]}},
        },
    )
    assert explicit.status_code == 200
    assert explicit.json()["result"]["submission"]["id"] == submissions["B"]
    mismatch = client.post(
        "/api/agent/tools/execute",
        json={
            "tool_name": "get_review_feedback",
            "arguments": {"submission_id": submissions["A"]},
            "client_context": {"active_project": {"id": projects["B"]}},
        },
    )
    assert mismatch.status_code == 404
    # Same-project retries select the newest application deterministically.
    sub = VerificationSubmission(
        id=ids.new_id(ids.VERIFICATION),
        artifact_id=db_session.get(VerificationSubmission, submissions["B"]).artifact_id,
        owner_id=owner.id,
        artifact_revision=1,
        snapshot={},
        snapshot_sha256="0" * 64,
        status="approved",
        note="B第二次",
        created_at=utcnow() + timedelta(seconds=20),
    )
    db_session.add(sub)
    db_session.commit()
    assert (
        runtime.tool_get_review_feedback(db_session, owner.id, project_id=projects["B"])[
            "submission"
        ]["id"]
        == sub.id
    )
    login_as(make_player())
    project(client, "其他玩家自己的项目")
    for args, context in [
        ({}, {"active_project": {"id": projects["B"]}}),
        ({"submission_id": submissions["B"]}, None),
    ]:
        response = client.post(
            "/api/agent/tools/execute",
            json={"tool_name": "get_review_feedback", "arguments": args, "client_context": context},
        )
        assert response.status_code == 404


def test_overlapping_combined_and_separate_fees_require_clarification(client):
    response = client.post(
        "/api/agent/chat", json={"message": "算利润：售价100拿货40快递包材8包材2"}
    )
    assert response.status_code == 200
    assert response.json()["roi_calculation"] is None
    assert response.json()["provider"] == "calculation_needs_input"
    assert "重叠" in response.json()["reply"]


def test_save_flag_accepts_actual_user_plan(client, make_player, login_as, db_session):
    login_as(make_player())
    selected = project(client, "用户方案")
    body = "商品是收纳盒，客群是小户型家庭，预算2000元，渠道为小红书，先测试十件。"
    response = chat(client, selected, body, save_as_draft=True)
    assert response.status_code == 200
    saved = response.json()["saved_artifact"]
    assert saved is not None
    assert revision(db_session, saved["id"])["summary"] == body


def test_failed_generation_never_saves_old_draft_as_new_plan(
    client, make_player, login_as, db_session
):
    owner = make_player()
    login_as(owner)
    selected = project(client, "已有旧方案")
    old = runtime.tool_save_business_draft(
        db_session,
        owner.id,
        level_id="L1",
        project_id=selected,
        content={"summary": "原方案", "budget": 2000},
    )
    db_session.commit()
    response = chat(client, selected, "生成草稿：请整理新的经营方案")
    assert response.status_code == 200
    assert response.json()["saved_artifact"] is None
    db_session.expire_all()
    assert db_session.get(Artifact, old["artifact_id"]).current_revision == 1
