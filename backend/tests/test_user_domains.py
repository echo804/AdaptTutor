"""用户自建领域 API 测试（M4r8d）。

覆盖：创建（上传/文本）→ 异步任务状态 → 发布（私有直接/公开提交审核）→
管理员审核 → 可见性隔离 → 举报下架。生成函数用 monkeypatch 替换（避免真实 LLM）。
"""

import uuid
from datetime import datetime, timedelta, timezone

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.persistence.db import get_session_factory
from app.persistence.models import InviteCode, UserDomain


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


async def _register(client, admin: bool = False) -> tuple[str, int]:
    code = await _make_invite_code()
    uname = f"u_{uuid.uuid4().hex[:6]}"
    r = await client.post(
        "/auth/register",
        json={"username": uname, "password": "secret123", "invite_code": code},
    )
    body = r.json()
    token, uid = body["token"], body["user_id"]
    if admin:
        factory = get_session_factory()
        async with factory() as db:
            from sqlalchemy import text

            await db.execute(text(f"UPDATE users SET meta = COALESCE(meta, '{{}}'::jsonb) || '{{\"is_admin\": true}}' WHERE id = {uid}"))
            await db.commit()
    return token, uid


async def _fake_generate_ok(domain_id: int, source_dir) -> None:
    """假生成：直接置任务 done + 领域统计（避免真实 LLM）。"""
    factory = get_session_factory()
    async with factory() as db:
        from sqlalchemy import select

        from app.persistence.models import GenerationTask

        res = await db.execute(select(GenerationTask).where(GenerationTask.domain_id == domain_id).order_by(GenerationTask.id.desc()).limit(1))
        t = res.scalar_one_or_none()
        if t:
            t.status = "done"
            t.progress = 100
            t.stage = "完成"
        d = await db.get(UserDomain, domain_id)
        if d:
            d.nodes_count = 5
            d.questions_count = 8
        await db.commit()


@pytest.fixture
def no_llm(monkeypatch):
    monkeypatch.setattr("app.api.routes_user_domains.generate_domain", _fake_generate_ok)


async def test_create_domain_with_text(client, no_llm):
    """粘贴文本创建领域 → 任务启动（running）→ 假生成后 done。"""
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        "/api/v1/user-domains",
        data={"name": "测试领域", "description": "desc", "visibility": "private", "text": "# 主题\n## 概念\n内容内容内容内容内容内容内容内容内容内容内容内容"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "draft"

    r = await client.get("/api/v1/user-domains", headers=h)
    items = r.json()["items"]
    assert any(i["id"] == body["domain_id"] and i["name"] == "测试领域" for i in items)


async def test_create_domain_requires_material(client):
    """无素材 → 400。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/v1/user-domains", data={"name": "空领域"}, headers=h)
    assert r.status_code == 400


async def test_publish_private_vs_public(client, no_llm):
    """私有 → 直接 published；公开 → pending_review。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    for vis, expect in [("private", "published"), ("public", "pending_review")]:
        r = await client.post(
            "/api/v1/user-domains",
            data={"name": f"领域{vis}", "visibility": vis, "text": "# 素材\n内容内容内容内容内容内容内容内容内容内容内容内容内容内容"},
            headers=h,
        )
        did = r.json()["domain_id"]
        await asyncio.sleep(0.3)  # 等假生成任务完成
        r = await client.post(f"/api/v1/user-domains/{did}/publish", headers=h)
        assert r.json()["status"] == expect, f"{vis} 发布状态错误"


async def test_visibility_isolation(client, no_llm):
    """可见性隔离：A 的私有领域 B 不可见；A 公开+审核通过后 B 可见。"""
    ta, ua = await _register(client)
    tb, ub = await _register(client)
    ha, hb = {"Authorization": f"Bearer {ta}"}, {"Authorization": f"Bearer {tb}"}

    # A 建公开领域并发布（pending_review）
    r = await client.post(
        "/api/v1/user-domains",
        data={"name": "共享领域", "visibility": "public", "text": "# 素材\n内容内容内容内容内容内容内容内容内容内容内容内容内容内容"},
        headers=ha,
    )
    did = r.json()["domain_id"]
    pack_id = r.json()["pack_id"]
    await asyncio.sleep(0.3)
    await client.post(f"/api/v1/user-domains/{did}/publish", headers=ha)

    # 审核通过前 B 不可见（pending_review 仅所有者）
    r = await client.get("/api/v1/domains", headers=hb)
    assert not any(p["id"] == pack_id for p in r.json()["packs"])

    # 管理员审核通过 → B 可见
    admin_token, _ = await _register(client, admin=True)
    ha2 = {"Authorization": f"Bearer {admin_token}"}
    r = await client.post(f"/api/v1/admin/domains/{did}/review", data={"approve": "true"}, headers=ha2)
    assert r.json()["status"] == "published"
    r = await client.get("/api/v1/domains", headers=hb)
    assert any(p["id"] == pack_id for p in r.json()["packs"])

    # A 的私有领域 B 始终不可见
    r = await client.post(
        "/api/v1/user-domains",
        data={"name": "私有领域", "visibility": "private", "text": "# 素材\n内容内容内容内容内容内容内容内容内容内容内容内容内容内容"},
        headers=ha,
    )
    pid = r.json()["pack_id"]
    await asyncio.sleep(0.3)
    await client.post(f"/api/v1/user-domains/{r.json()['domain_id']}/publish", headers=ha)
    r = await client.get("/api/v1/domains", headers=hb)
    assert not any(p["id"] == pid for p in r.json()["packs"])


async def test_admin_requires_permission(client):
    """非管理员访问审核接口 → 403。"""
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.get("/api/v1/admin/domains", headers=h)
    assert r.status_code == 403


async def test_report_takedown(client, no_llm):
    """举报公开领域 → 下架。"""
    ta, _ = await _register(client)
    tb, _ = await _register(client)
    ha, hb = {"Authorization": f"Bearer {ta}"}, {"Authorization": f"Bearer {tb}"}
    r = await client.post(
        "/api/v1/user-domains",
        data={"name": "举报目标", "visibility": "public", "text": "# 素材\n内容内容内容内容内容内容内容内容内容内容内容内容内容内容"},
        headers=ha,
    )
    did, pack_id = r.json()["domain_id"], r.json()["pack_id"]
    await asyncio.sleep(0.3)
    await client.post(f"/api/v1/user-domains/{did}/publish", headers=ha)
    admin_token, _ = await _register(client, admin=True)
    await client.post(f"/api/v1/admin/domains/{did}/review", data={"approve": "true"}, headers={"Authorization": f"Bearer {admin_token}"})

    r = await client.post(f"/api/v1/domains/report/{pack_id}", headers=hb)
    assert r.json()["status"] == "takedown"
    r = await client.get("/api/v1/domains", headers=hb)
    assert not any(p["id"] == pack_id for p in r.json()["packs"])
