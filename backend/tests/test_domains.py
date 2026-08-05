"""多领域 API 测试（M4r8）。

覆盖：包列表 / 用户激活偏好 / 带 pack 建会话 / 图谱 / 掌握度与错题跨领域隔离。
依赖 fixture 目录 tests/fixtures/mini_pack（迷你领域包）。
"""

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.persistence.db import get_session_factory
from app.persistence.models import InviteCode

FIXTURE_ROOT = str(Path(__file__).parent / "fixtures")  # 含 mini_pack/ 包目录


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
    body = r.json()
    return body["token"], body["user_id"]


@pytest.fixture
def pack_dir(monkeypatch):
    """把领域包目录指到测试 fixture（mini_pack）。"""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "domain_pack_path", FIXTURE_ROOT)
    return FIXTURE_ROOT


async def test_domains_list_and_active(client, pack_dir):
    """GET /api/v1/domains：包列表 + 默认激活包回退。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.get("/api/v1/domains", headers=h)
    assert r.status_code == 200
    body = r.json()
    ids = [p["id"] for p in body["packs"]]
    assert "mini_pack" in ids
    assert body["active"]  # 回退 settings.active_domain_pack（非空）


async def test_set_active_pack(client, pack_dir):
    """PUT /me/active-pack：切换生效 + 非法包 404。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.put("/api/v1/me/active-pack", json={"pack_id": "mini_pack"}, headers=h)
    assert r.status_code == 200
    assert r.json()["active"] == "mini_pack"

    r = await client.get("/api/v1/domains", headers=h)
    assert r.json()["active"] == "mini_pack"

    r = await client.put("/api/v1/me/active-pack", json={"pack_id": "no_such_pack"}, headers=h)
    assert r.status_code == 404


async def test_create_session_with_pack(client, pack_dir):
    """POST /sessions 带 pack_id：诊断首题来自该领域包。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post(
        "/api/v1/sessions",
        json={"type": "diagnostic", "pack_id": "mini_pack", "config": {"qtypes": ["choice"], "qcount": 2}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["question"]["id"] == "m001"  # mini_pack 首题


async def test_graph_with_pack(client, pack_dir):
    """GET /graph?pack_id=mini_pack：返回迷你包节点。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.get("/api/v1/graph?pack_id=mini_pack", headers=h)
    assert r.status_code == 200
    nodes = {n["id"] for n in r.json()["nodes"]}
    assert {"a1", "b1"} <= nodes


async def test_mastery_isolation_across_packs(client, pack_dir):
    """掌握度跨领域隔离：mini_pack 诊断作答只写 mini_pack 的 mastery，junior 包不受影响。"""
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)

    # 在 mini_pack 建诊断并答对 1 题
    r = await client.post(
        "/api/v1/sessions",
        json={"type": "diagnostic", "pack_id": "mini_pack", "config": {"qtypes": ["choice"], "qcount": 2}},
        headers=h,
    )
    sid = r.json()["session_id"]
    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "甲"}, headers=h)
    assert r.status_code == 200

    # mini_pack 掌握度有数据
    r = await client.get(f"/api/v1/students/{uid}/mastery?pack_id=mini_pack", headers=h)
    assert r.json()["mastery"]
    # 默认领域（junior_math_eq_ineq 回退）无数据
    r = await client.get(f"/api/v1/students/{uid}/mastery", headers=h)
    assert not r.json()["mastery"]


async def test_wrong_questions_isolation_across_packs(client, pack_dir):
    """错题跨领域隔离：mini_pack 判错只出现在 mini_pack 错题集。"""
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)

    r = await client.post(
        "/api/v1/sessions",
        json={"type": "diagnostic", "pack_id": "mini_pack", "config": {"qtypes": ["choice"], "qcount": 2}},
        headers=h,
    )
    sid = r.json()["session_id"]
    await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "乙"}, headers=h)

    r = await client.get(f"/api/v1/students/{uid}/wrong-questions?pack_id=mini_pack", headers=h)
    assert any(i["qid"] == "m001" for i in r.json()["items"])
    r = await client.get(f"/api/v1/students/{uid}/wrong-questions", headers=h)
    assert not any(i["qid"] == "m001" for i in r.json()["items"])
