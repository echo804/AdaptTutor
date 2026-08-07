"""M6 编辑器完善：空白领域包 API 测试（创建→加载合法→GET 详情→PUT 保存→编辑器可访问）。"""

import asyncio
import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
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


async def _cleanup_pack(pack_id: str) -> None:
    root = Path(get_settings().domain_pack_path)
    shutil.rmtree(root / pack_id, ignore_errors=True)
    factory = get_session_factory()
    async with factory() as db:
        d = (
            await db.execute(
                __import__("sqlalchemy").select(UserDomain).where(UserDomain.pack_id == pack_id)
            )
        ).scalar_one_or_none()
        if d is not None:
            await db.delete(d)
            await db.commit()


@pytest.fixture
async def blank_domain(client):
    """注册用户 → 创建空白领域 → yield (token, user_id, pack_id, domain_id)；测试结束清理。"""
    token, uid = await _register(client)
    r = await client.post(
        "/api/v1/user-domains/blank",
        data={"name": f"空白包 {uuid.uuid4().hex[:4]}", "description": "pytest 自动化"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "published"
    yield token, uid, d["pack_id"], d["domain_id"]
    await _cleanup_pack(d["pack_id"])


# ---------- 创建 ----------


async def test_blank_domain_created_published(client):
    token, _, pack_id, _ = await _blank_domain_manual(client)
    # 目录里 5 个文件齐全
    root = Path(get_settings().domain_pack_path) / pack_id
    for f in ("pack_manifest.json", "knowledge_graph.json", "questions.json", "diagnostic_rules.json", "assessment_config.json"):
        assert (root / f).is_file(), f"缺少 {f}"
    # 空内容
    kg = json.loads((root / "knowledge_graph.json").read_text(encoding="utf-8"))
    assert kg["nodes"] == [] and kg["edges"] == []
    qs = json.loads((root / "questions.json").read_text(encoding="utf-8"))
    assert qs == []
    await _cleanup_pack(pack_id)


async def _blank_domain_manual(client) -> tuple[str, int, str, int]:
    token, uid = await _register(client)
    r = await client.post(
        "/api/v1/user-domains/blank",
        data={"name": f"空白包 {uuid.uuid4().hex[:4]}"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return token, uid, d["pack_id"], d["domain_id"]


async def test_blank_domain_name_required(client):
    token, _ = await _register(client)
    r = await client.post(
        "/api/v1/user-domains/blank",
        data={"name": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


# ---------- 编辑器链路：GET 详情 / PUT 保存 ----------


async def test_blank_domain_editor_roundtrip(client, blank_domain):
    token, _, pack_id, _ = blank_domain
    # GET 详情（编辑器加载）
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["editable"] is True
    assert detail["graph"]["nodes"] == []
    assert detail["questions"] == []

    # 手工加一个节点 + 一道题 → PUT 保存（对齐 GET 详情返回的 DomainPack 嵌套结构）
    body = {
        "manifest": {"id": pack_id, "version": "0.1.0", "subject": "空白包测试"},
        "graph": {
            "nodes": [
                {"id": "n01", "name": "测试知识点", "difficulty": 0.5, "importance": 0.7}
            ],
            "edges": [],
        },
        "questions": [
            {
                "id": "nq001",
                "type": "choice",
                "content": "1+1=?",
                "difficulty": 0.5,
                "options": ["A. 1", "B. 2", "C. 3", "D. 4"],
                "answer": "B",
                "tags": [],
                "step_node_map": {"step1": "n01"},
            }
        ],
        "diagnostic_rules": {"initial_strategy": "weakest_node", "termination": {"confidence_threshold": 0.8, "max_questions": 15}},
        "assessment": {"purity_threshold": 0.9, "mastery_threshold": 0.85},
    }
    r = await client.put(f"/api/v1/domains/{pack_id}", json=body, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["nodes"] == 1 and saved["questions"] == 1

    # 重新 GET → 内容一致
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token}"})
    detail2 = r.json()
    assert len(detail2["graph"]["nodes"]) == 1
    assert detail2["questions"][0]["id"] == "nq001"

    # 列表可见（published + private，非 draft 不踢出）
    r = await client.get("/api/v1/user-domains", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert any(i["pack_id"] == pack_id for i in r.json()["items"])


async def test_blank_domain_other_user_forbidden(client, blank_domain):
    token, uid, pack_id, domain_id = blank_domain
    token2, _ = await _register(client)
    # M6.1 安全修复：非 owner 读他人私有包 → 404（不再可越权读取，含答案内容）
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token2}"})
    assert r.status_code == 404, r.text
    r = await client.put(
        f"/api/v1/domains/{pack_id}",
        json={"manifest": {"id": pack_id, "version": "0.1.0", "subject": "x"}, "graph": {"nodes": [], "edges": []}, "questions": [], "diagnostic_rules": {}, "assessment": {}},
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert r.status_code == 403

    # 发布流程：private → published 后仍非公开，他人依旧 404
    r = await client.post(f"/api/v1/user-domains/{domain_id}/publish", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token2}"})
    assert r.status_code == 404

    # 置为 public + pending_review（模拟提交公开审核），他人仍 404
    factory = get_session_factory()
    from sqlalchemy import select as _select
    from app.persistence.models import User as _User
    async with factory() as db:
        d = (await db.execute(_select(UserDomain).where(UserDomain.pack_id == pack_id))).scalar_one()
        d.visibility = "public"
        d.status = "pending_review"
        await db.commit()
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token2}"})
    assert r.status_code == 404, r.text

    # 管理员审核通过 → 他人可读（editable=False），owner 仍可读可改
    async with factory() as db:
        u = (await db.execute(_select(_User).where(_User.id == uid))).scalar_one()
        u.meta = {**(u.meta or {}), "is_admin": True}
        await db.commit()
    r = await client.post(
        f"/api/v1/admin/domains/{domain_id}/review",
        data={"approve": "true", "reason": "ok"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token2}"})
    assert r.status_code == 200, r.text
    assert r.json()["editable"] is False
    r = await client.get(f"/api/v1/domains/{pack_id}", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["editable"] is True

