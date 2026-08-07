"""M6 可视化领域编辑器 API 测试：包详情 / validate / 保存（临时包，不污染内置包）。"""

import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from pathlib import Path

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


@pytest.fixture
async def tmp_pack():
    """复制内置包为临时包目录（manifest.id 同步改名）；测试结束删除。"""
    root = Path(get_settings().domain_pack_path)
    src = root / "junior_math_eq_ineq"
    pack_id = f"test_editor_{uuid.uuid4().hex[:8]}"
    dst = root / pack_id
    shutil.copytree(src, dst)
    mf = dst / "pack_manifest.json"
    m = json.loads(mf.read_text(encoding="utf-8"))
    m["id"] = pack_id
    mf.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    yield pack_id
    shutil.rmtree(dst, ignore_errors=True)


async def _create_user_domain(user_id: int, pack_id: str) -> None:
    factory = get_session_factory()
    async with factory() as db:
        db.add(
            UserDomain(
                user_id=user_id,
                pack_id=pack_id,
                name="测试领域",
                visibility="private",
                status="draft",
            )
        )
        await db.commit()


# --- 详情 ---


async def test_domain_detail_builtin_not_editable(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.get("/api/v1/domains/junior_math_eq_ineq", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["editable"] is False
    assert data["manifest"]["id"] == "junior_math_eq_ineq"
    assert len(data["graph"]["nodes"]) > 0
    assert len(data["questions"]) > 0
    assert "diagnostic_rules" in data and "assessment" in data


async def test_domain_detail_404(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    r = await client.get("/api/v1/domains/no_such_pack_xyz", headers=h)
    assert r.status_code == 404


# --- validate ---


async def _load_body(client, h, pack_id: str) -> dict:
    r = await client.get(f"/api/v1/domains/{pack_id}", headers=h)
    body = r.json()
    body.pop("editable")
    return body


async def test_domain_validate_ok(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    body = await _load_body(client, h, "junior_math_eq_ineq")
    r = await client.post("/api/v1/domains/validate", json=body, headers=h)
    assert r.status_code == 200
    assert r.json() == {"valid": True, "errors": []}


async def test_domain_validate_cycle_rejected(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    body = await _load_body(client, h, "junior_math_eq_ineq")
    ids = [n["id"] for n in body["graph"]["nodes"]]
    body["graph"]["edges"].append(
        {"from": ids[1], "to": ids[0], "type": "prerequisite"}
    )
    r = await client.post("/api/v1/domains/validate", json=body, headers=h)
    assert r.status_code == 200
    out = r.json()
    assert out["valid"] is False
    assert "循环依赖" in out["errors"][0]


async def test_domain_validate_dangling_step_rejected(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    body = await _load_body(client, h, "junior_math_eq_ineq")
    body["questions"][0]["step_node_map"] = {"step1": "ghost_node"}
    r = await client.post("/api/v1/domains/validate", json=body, headers=h)
    out = r.json()
    assert out["valid"] is False
    assert "ghost_node" in out["errors"][0]


# --- 保存 ---


async def test_domain_save_forbidden_builtin(client):
    token, _ = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    body = await _load_body(client, h, "junior_math_eq_ineq")
    r = await client.put("/api/v1/domains/junior_math_eq_ineq", json=body, headers=h)
    assert r.status_code == 403


async def test_domain_save_roundtrip(client, tmp_pack):
    """自建包 PUT 保存 → 写回磁盘 → GET 详情确认内容已变。"""
    token, user_id = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await _create_user_domain(user_id, tmp_pack)

    r = await client.get(f"/api/v1/domains/{tmp_pack}", headers=h)
    assert r.json()["editable"] is True
    body = r.json()
    body.pop("editable")
    body["questions"][0]["difficulty"] = 0.99
    body["manifest"]["version"] = "9.9.9"

    r2 = await client.put(f"/api/v1/domains/{tmp_pack}", json=body, headers=h)
    assert r2.status_code == 200, r2.text
    assert r2.json()["questions"] == len(body["questions"])

    r3 = await client.get(f"/api/v1/domains/{tmp_pack}", headers=h)
    assert r3.json()["questions"][0]["difficulty"] == 0.99
    assert r3.json()["manifest"]["version"] == "9.9.9"

    root = Path(get_settings().domain_pack_path) / tmp_pack
    qs = json.loads((root / "questions.json").read_text(encoding="utf-8"))
    assert qs[0]["difficulty"] == 0.99


async def test_domain_save_bad_data_422(client, tmp_pack):
    token, user_id = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await _create_user_domain(user_id, tmp_pack)
    body = await _load_body(client, h, tmp_pack)
    ids = [n["id"] for n in body["graph"]["nodes"]]
    body["graph"]["edges"].append(
        {"from": ids[1], "to": ids[0], "type": "prerequisite"}
    )
    r = await client.put(f"/api/v1/domains/{tmp_pack}", json=body, headers=h)
    assert r.status_code == 422


async def test_domain_save_not_owner_forbidden(client, tmp_pack):
    """他人自建包不可编辑（403）；M6.1 起他人读私有包也 404。"""
    _, user_a = await _register(client)
    await _create_user_domain(user_a, tmp_pack)
    token_b, _ = await _register(client)
    hb = {"Authorization": f"Bearer {token_b}"}
    # M6.1：非 owner 读他人私有包 → 404（不再返回内容）
    r = await client.get(f"/api/v1/domains/{tmp_pack}", headers=hb)
    assert r.status_code == 404
    # 直接构造合法 body 测写权限（owner 检查在 schema 校验前）
    body = {
        "manifest": {"id": tmp_pack, "version": "0.1.0", "subject": "x"},
        "graph": {"nodes": [], "edges": []},
        "questions": [],
        "diagnostic_rules": {},
        "assessment": {},
    }
    r = await client.put(f"/api/v1/domains/{tmp_pack}", json=body, headers=hb)
    assert r.status_code == 403
