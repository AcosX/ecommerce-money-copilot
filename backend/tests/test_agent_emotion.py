from datetime import timedelta

from emc_api.agent.contracts import CompanionState
from emc_api.agent.emotion import (
    EmotionPolicy,
    emotion_profile,
    performance_effects,
    style_instruction,
)
from emc_api.agent.relationship import evolve
from emc_api.agent.runtime import AgentRuntime
from emc_api.models import AgentEngagement, AgentState, Artifact
from emc_api.timeutil import utcnow

from .test_agent import project


def test_stall_decay_is_incremental_and_progress_restores_patience():
    policy = EmotionPolicy(grace_seconds=60, decay_interval_seconds=30, decay_points=10)
    perf = {"stagnant_seconds": 180, "active_seconds": 180, "progress_token": "original"}
    a, p, memory, reasons = performance_effects(20, 80, {}, "L1", perf, policy)
    assert p == 40 and "level_stalled" in reasons
    assert performance_effects(a, p, memory, "L1", perf, policy)[1] == 40
    perf["stagnant_seconds"] = 210
    assert performance_effects(a, p, memory, "L1", perf, policy)[1] == 30
    perf.update(stagnant_seconds=0, progress_token="new-content")
    a, p, memory, reasons = performance_effects(a, p, memory, "L1", perf, policy)
    assert (a, p) == (22, 48) and reasons == ["verified_progress"]
    assert performance_effects(a, p, memory, "L1", perf, policy)[:2] == (22, 48)
    assert performance_effects(a, p, memory, "L2", perf, policy)[:2] == (27, 80)


def test_activity_does_not_count_as_rest_and_confusion_is_not_empty_repetition():
    now = utcnow()
    _, _, memory = evolve(
        20, 80, {}, "你好", "L1", now, {"active_seconds": 0, "progress_token": "a"}
    )
    perf = {"active_seconds": 1800, "stagnant_seconds": 1800, "progress_token": "a"}
    a, p, memory = evolve(21, 80, memory, "另一个问题", "L1", now + timedelta(minutes=30), perf)
    assert p == 70
    a, p, memory = evolve(a, p, memory, "没懂，请再解释一次", "L1", now)
    for _ in range(4):
        a, p, memory = evolve(a, p, memory, "没懂，请再解释一次", "L1", now)
    assert p == 70
    for _ in range(3):
        a, p, memory = evolve(a, p, memory, "下一步", "L1", now)
    assert p == 66
    a, p, memory = evolve(a, p, memory, "我懒得动，再拖一会", "L1", now)
    assert p == 61 and "deliberate_delay" in memory["last_change"]["reason_codes"]


def test_all_mood_bands_and_affinity_reach_model_prompt():
    assert [emotion_profile(20, p).mood for p in (80, 60, 40, 20, 0)] == [
        "耐心",
        "催促",
        "不耐烦",
        "刻薄",
        "火大",
    ]
    assert emotion_profile(90, 20).relationship == "亲密搭档"
    assert emotion_profile(10, 20).relationship == "疏离观察"

    class Catalog:
        def load(self, *args):
            return [], [], ""

    class Capture:
        def generate(self, messages):
            self.system = "\n".join(m["content"] for m in messages if m["role"] == "system")
            return "先做完这一件。"

    generator = Capture()
    AgentRuntime(Catalog(), generator).reply(
        "下一步",
        "小商",
        {"level": "L1", "platform": "xiaohongshu"},
        CompanionState(affinity=10, patience=0),
        [],
        {},
    )
    assert "火大" in generator.system and "疏离观察" in generator.system
    assert "不要始终保持同一种友善腔调" in generator.system
    assert "不能拒绝答疑" in style_instruction(emotion_profile(10, 0))


def test_activity_projection_commits_once_with_reply(
    client, app, make_player, login_as, db_session
):
    pid = project(client, make_player, login_as)
    settings = app.state.settings
    settings.agent_emotion_grace_seconds = 60
    settings.agent_emotion_decay_interval_seconds = 30
    settings.agent_emotion_decay_points = 10
    path = f"/api/agent/projects/{pid}"
    first = client.post(path + "/activity", json={})
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 1
    row = db_session.get(AgentEngagement, pid)
    row.stagnant_seconds = row.active_seconds = 180
    db_session.commit()
    preview = client.get(path + "/state").json()
    assert preview["patience"] == 40 and preview["emotion"]["mood"] == "不耐烦"
    assert preview["version"] == 1
    assert client.get(path + "/state").json()["patience"] == 40
    result = client.post(
        path + "/messages",
        json={"message": "你好", "version": 1},
        headers={"Idempotency-Key": "emotion-once"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["state"]["patience"] == 40
    db_session.expire_all()
    assert db_session.get(AgentState, pid).patience == 40
    assert client.get(path + "/state").json()["patience"] == 40
    assert client.post(path + "/activity", json={"elapsed_seconds": 999999}).status_code == 422
    login_as(make_player())
    assert client.post(path + "/activity", json={}).status_code == 404


def test_background_gap_and_review_wait_do_not_decay(client, make_player, login_as, db_session):
    pid = project(client, make_player, login_as)
    path = f"/api/agent/projects/{pid}"
    client.post(path + "/activity", json={})
    row = db_session.get(AgentEngagement, pid)
    row.last_seen_at = utcnow() - timedelta(hours=8)
    db_session.commit()
    assert client.post(path + "/activity", json={}).json()["emotion"]["level_active_seconds"] == 0
    db_session.expire_all()
    row = db_session.get(AgentEngagement, pid)
    row.last_seen_at = utcnow() - timedelta(seconds=60)
    db_session.commit()
    reset = client.post(path + "/activity", json={"reset_clock": True}).json()
    assert reset["emotion"]["level_active_seconds"] == 0
    db_session.expire_all()
    row = db_session.get(AgentEngagement, pid)
    row.last_seen_at = utcnow() - timedelta(seconds=60)
    db_session.commit()
    assert client.post(path + "/activity", json={}).json()["emotion"]["level_active_seconds"] >= 59
    owner = client.get("/api/me").json()["player"]["id"]
    db_session.add(
        Artifact(
            id="art_waiting_review",
            project_id=pid,
            owner_id=owner,
            artifact_type="business_plan",
            schema_version=1,
            title="提交成果",
            status="submitted",
            origin="formal",
            current_revision=1,
            version=1,
        )
    )
    db_session.commit()
    result = client.post(path + "/activity", json={}).json()
    assert result["emotion"]["paused"] is True
