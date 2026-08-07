"""M6.1 安全收紧：邀请码生成仅管理员（普通用户 403，管理员正常）。"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.persistence.db import get_session_factory
from app.persistence.models import User


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _make_invite_code() -> str:
    """造一个邀请码（复用与 test_blank_domain_api 相同的方式）。"""
    import asyncio
    from datetime import datetime, timedelta, timezone

    from app.persistence.models import InviteCode

    factory = get_session_factory()
    code = f"inv-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    async with factory() as db:
        db.add(InviteCode(code=code, created_at=now, expires_at=now + timedelta(days=7)))
        await db.commit()
    return code


async def _register(client) -> tuple[str, int]:
    code = await _make_invite_code()
    uname = f"inv_{uuid.uuid4().hex[:8]}"
    r = await client.post(
        "/auth/register",
        json={"username": uname, "password": "Test123456", "invite_code": code},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return d["token"], d["user_id"]


async def _set_admin(uid: int, is_admin: bool = True) -> None:
    factory = get_session_factory()
    async with factory() as db:
        u = (await db.execute(select(User).where(User.id == uid))).scalar_one()
        u.meta = {**(u.meta or {}), "is_admin": is_admin}
        await db.commit()


async def test_normal_user_cannot_create_invite(client):
    token, _ = await _register(client)
    r = await client.post("/me/invite-codes", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.text
    assert "仅管理员" in r.json()["detail"]


async def test_normal_user_can_list_own(client):
    token, _ = await _register(client)
    r = await client.get("/me/invite-codes", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


async def test_admin_can_create_invite(client):
    token, uid = await _register(client)
    await _set_admin(uid)
    r = await client.post("/me/invite-codes", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["code"]
    # 列表能看到刚生成的
    r = await client.get("/me/invite-codes", headers={"Authorization": f"Bearer {token}"})
    assert len(r.json()["items"]) == 1
