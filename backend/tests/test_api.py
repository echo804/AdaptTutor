"""API 集成测试（M4：注册/登录/鉴权/越权/key 门槛/会话闭环）。

需要 PG（docker compose -f docker-compose.local.yml up -d postgres）。
用 httpx ASGITransport 直连 FastAPI app（无需起 uvicorn）。
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.persistence.db import get_session_factory
from app.persistence.models import InviteCode


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _make_invite_code() -> str:
    factory = get_session_factory()
    code = f"inv-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    async with factory() as db:
        db.add(InviteCode(code=code, created_at=now, expires_at=now + timedelta(days=7)))
        await db.commit()
    return code


async def _register(client, username: str | None = None) -> tuple[str, int]:
    code = await _make_invite_code()
    uname = username or f"u_{uuid.uuid4().hex[:6]}"
    r = await client.post(
        "/auth/register",
        json={"username": uname, "password": "secret123", "invite_code": code},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return data["token"], data["user_id"]


# ---- 认证 ----

async def test_bootstrap_returns_needs_invite(client):
    """当前库已有用户 → needs_invite=true（首用户免邀请码场景在空库生效）。"""
    r = await client.get("/auth/bootstrap")
    assert r.status_code == 200
    assert r.json()["needs_invite"] is True


async def test_register_and_login(client):
    code = await _make_invite_code()
    r = await client.post(
        "/auth/register",
        json={"username": f"u_{uuid.uuid4().hex[:6]}", "password": "secret123", "invite_code": code},
    )
    assert r.status_code == 200
    token = r.json()["token"]

    # me
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["username"]

    # login
    r = await client.post("/auth/login", json={"username": r.json()["username"], "password": "secret123"})
    assert r.status_code == 200
    assert r.json()["token"]


async def test_register_invalid_invite(client):
    r = await client.post(
        "/auth/register",
        json={"username": f"u_{uuid.uuid4().hex[:6]}", "password": "secret123", "invite_code": "bad-code"},
    )
    assert r.status_code == 400


async def test_login_wrong_password(client):
    await _register(client)
    r = await client.post("/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401


async def test_me_requires_token(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401


# ---- key 门槛与配置 ----

async def test_ai_access_blocked_without_key(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/v1/sessions", json={"type": "diagnostic"}, headers=h)
    assert r.status_code == 403  # 未配 key


async def test_key_put_masked_and_access_granted(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}

    r = await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    assert r.status_code == 200
    assert r.json()["masked_key"] == "sk-s****efgh"  # 掩码，无明文
    assert "secret" not in r.json()["masked_key"]

    r = await client.get("/me/api-keys", headers=h)
    assert r.status_code == 200
    keys = r.json()
    assert any(k["provider"] == "deepseek" for k in keys)

    # 配 key 后可建会话
    r = await client.post("/api/v1/sessions", json={"type": "diagnostic"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["session_id"] > 0


# ---- 会话闭环 ----

async def test_diagnostic_session_flow(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)

    r = await client.post("/api/v1/sessions", json={"type": "diagnostic"}, headers=h)
    sid = r.json()["session_id"]
    assert r.json()["first_message"]

    # 作答两轮
    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "correct": True}, headers=h)
    assert r.status_code == 200
    assert r.json()["message"]

    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "correct": False}, headers=h)
    assert r.status_code == 200

    # 消息历史
    r = await client.get(f"/api/v1/sessions/{sid}/messages", headers=h)
    assert r.status_code == 200
    assert len(r.json()) >= 4  # user/assistant × 2


async def test_session_detail_and_restore(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post("/api/v1/sessions", json={"type": "tutor"}, headers=h)
    sid = r.json()["session_id"]

    r = await client.get(f"/api/v1/sessions/{sid}", headers=h)
    assert r.status_code == 200
    assert r.json()["state"] == "elicit"


async def test_cross_user_forbidden(client):
    token_a, _ = await _register(client)
    token_b, _ = await _register(client)
    ha = {"Authorization": f"Bearer {token_a}"}
    hb = {"Authorization": f"Bearer {token_b}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=ha)
    r = await client.post("/api/v1/sessions", json={"type": "diagnostic"}, headers=ha)
    sid = r.json()["session_id"]

    # B 访问 A 的会话 → 403
    r = await client.get(f"/api/v1/sessions/{sid}", headers=hb)
    assert r.status_code == 403


async def test_mastery_dashboard_data(client):
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post("/api/v1/sessions", json={"type": "diagnostic"}, headers=h)
    sid = r.json()["session_id"]
    await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "correct": True}, headers=h)

    r = await client.get(f"/api/v1/students/{uid}/mastery", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["mastery"]  # 真实掌握度数据
    assert data["weakest"]

    r = await client.get(f"/api/v1/students/{uid}/path", headers=h)
    assert r.status_code == 200
    assert r.json()["path"]


# ---- 阿里云百炼（DashScope） ----

async def test_bailian_models_and_prefs(client):
    """百炼模型列表 + 模型偏好存取（04 v0.9：百炼免费额度模型）。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}

    # 模型列表
    r = await client.get("/me/api-keys/bailian/models", headers=h)
    assert r.status_code == 200
    models = r.json()
    ids = [m["id"] for m in models]
    assert "dashscope/qwen-turbo" in ids
    assert "dashscope/deepseek-v3" in ids  # 百炼托管 DeepSeek

    # 配百炼 key
    r = await client.put(
        "/me/api-keys/bailian",
        json={"provider": "bailian", "api_key": "sk-bailian-test-1234"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["masked_key"] == "sk-b****1234"  # 掩码

    # 保存模型偏好
    prefs = {"tutor": "dashscope/deepseek-v3", "generate": "dashscope/qwen-turbo"}
    r = await client.put("/me/api-keys/settings", json={"bailian_models": prefs}, headers=h)
    assert r.status_code == 200

    # 回读
    r = await client.get("/me/api-keys/settings", headers=h)
    assert r.json()["bailian_models"]["tutor"] == "dashscope/deepseek-v3"


async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["db"] == "up"
