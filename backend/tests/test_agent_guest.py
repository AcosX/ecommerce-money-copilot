from sqlalchemy import select

from emc_api.agent.runtime import AgentRuntime
from emc_api.models import AgentGuestSession


class Generator:
    def __init__(self):
        self.calls = []

    def generate(self, messages):
        self.calls.append(messages)
        return "先列预算和货源，我帮你比较。"


def bootstrap(client):
    response = client.post(
        "/api/agent/guest/session",
        json={"level": "L3", "platform": "pinduoduo"},
        headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 200, response.text
    client.headers.update(
        {"Origin": "http://testserver", "X-CSRF-Token": response.json()["csrf_token"]}
    )
    return response.json()


def test_guest_isolation_csrf_model_and_replay(client, app, settings, db_session, make_client):
    settings.agent_guest_enabled = True
    generator = Generator()
    app.state.agent_runtime = AgentRuntime(app.state.agent_runtime.catalog, generator)
    info = bootstrap(client)
    assert client.get("/api/me").json()["authenticated"] is False
    assert client.get(f"/api/agent/projects/{info['project_id']}/state").status_code == 401
    assert client.get("/api/agent/guest/state").json()["level"] == "L3"
    body = {"version": 1, "message": "我有2000预算，已经做了素材，怎么优化？"}
    path = "/api/agent/guest/messages"
    assert client.post(path, json=body, headers={"X-CSRF-Token": "bad"}).status_code == 403
    headers = {"Idempotency-Key": "guest-turn"}
    result = client.post(path, json=body, headers=headers)
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "ai"
    assert len(generator.calls) == 1
    assert client.post(path, json=body, headers=headers).json() == result.json()
    assert len(generator.calls) == 1
    row = db_session.scalar(select(AgentGuestSession))
    assert row.messages_today == 1
    other = make_client()
    bootstrap(other)
    assert other.get("/api/agent/guest/history").json()["items"] == []
    assert len(client.get("/api/agent/guest/history").json()["items"]) == 1


def test_guest_disabled_origin_and_limit(client, app, settings):
    assert client.post("/api/agent/guest/session", json={}).status_code == 404
    settings.agent_guest_enabled = True
    assert (
        client.post(
            "/api/agent/guest/session", json={}, headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    settings.agent_guest_session_hourly_limit = 1
    bootstrap(client)
    client.cookies.clear()
    assert client.post("/api/agent/guest/session", json={}).status_code == 429
