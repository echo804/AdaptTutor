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

    # 作答两轮（M4r1：AI 判题，传答案内容）
    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "A"}, headers=h)
    assert r.status_code == 200
    assert r.json()["message"]
    assert "correct" in r.json() and "feedback" in r.json()

    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "B"}, headers=h)
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
    await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "A"}, headers=h)

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

# ---- M4r5：错题集生命周期 ----

async def test_wrong_questions_lifecycle(client):
    """判错落库 → 查询去重 → 移除（已掌握）。"""
    from app.persistence import repositories as repo

    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post("/api/v1/sessions", json={"type": "diagnostic"}, headers=h)
    sid = r.json()["session_id"]

    # 直接构造两条 wrong_answer 事件（同一题 q001，另一题 q002）
    factory = get_session_factory()
    async with factory() as db:
        await repo.add_event(
            db, uid, "wrong_answer", node_id="a01", session_id=sid,
            payload={"qid": "q001", "question": "测试题一", "type": "blank", "options": [],
                     "user_answer": "x", "correct_answer": "3"},
        )
        await repo.add_event(
            db, uid, "wrong_answer", node_id="a01", session_id=sid,
            payload={"qid": "q001", "question": "测试题一", "type": "blank", "options": [],
                     "user_answer": "y", "correct_answer": "3"},
        )
        await repo.add_event(
            db, uid, "wrong_answer", node_id="b02", session_id=sid,
            payload={"qid": "q002", "question": "测试题二", "type": "choice", "options": ["1", "2"],
                     "user_answer": "A", "correct_answer": "B"},
        )

    # 查询：q001/q002 各一条（去重）
    r = await client.get(f"/api/v1/students/{uid}/wrong-questions", headers=h)
    assert r.status_code == 200
    items = r.json()["items"]
    qids = {i["qid"] for i in items}
    assert qids == {"q001", "q002"}
    q1 = next(i for i in items if i["qid"] == "q001")
    assert q1["user_answer"] == "y"  # 最新判错优先

    # 移除 q001（已掌握）
    r = await client.delete(f"/api/v1/students/{uid}/wrong-questions/q001", headers=h)
    assert r.status_code == 200
    r = await client.get(f"/api/v1/students/{uid}/wrong-questions", headers=h)
    assert {i["qid"] for i in r.json()["items"]} == {"q002"}

    # 越权：另一用户不能查
    token_b, uid_b = await _register(client)
    r = await client.get(f"/api/v1/students/{uid_b}/wrong-questions", headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 200
    assert r.json()["items"] == []


async def test_diagnostic_config_qcount(client):
    """诊断配置：qcount 上限 → 3 轮后诊断完成。"""
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post(
        "/api/v1/sessions",
        json={"type": "diagnostic", "config": {"qtypes": ["choice"], "qcount": 3, "difficulty": "auto"}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["qcount"] == 3
    sid = r.json()["session_id"]
    for i in range(3):
        r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "A"}, headers=h)
        assert r.status_code == 200
        if i == 2:
            assert r.json()["done"] is True  # 3 题后结束
        else:
            assert r.json()["done"] is False

# ---- M4r7f：辅导会话 AI 判题 ----

async def test_tutor_verify_auto_judge(client):
    """辅导 VERIFY 态：用户消息自动判题，答对→通过，答错→重新定位+给答案。"""
    from app.engine.tutor_orchestrator import TutorOrchestrator
    from app.persistence import repositories as repo
    from app.persistence.db import get_session_factory

    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post("/api/v1/sessions", json={"type": "tutor"}, headers=h)
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]

    # ELICIT 态直接作答（M4r7g）：读初始题答案，答对 → 直接通过进入变式
    factory = get_session_factory()
    async with factory() as db:
        s = await repo.get_session(db, sid)
        t = TutorOrchestrator()
        t.restore_state(s.context or {})
        initial_q = t.verify_question
        assert initial_q is not None

    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "message", "content": f"{initial_q.answer}"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True, body  # ELICIT 直接答对
    assert body["state"] in ("done", "verify")

    # 推进到 VERIFY 态（答错 → 识别 → 提示 → 回应 → VERIFY）
    await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "message", "content": "我的思路是移项"}, headers=h)
    await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "message", "content": "第一步先合并同类项"}, headers=h)
    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "message", "content": "好"}, headers=h)
    assert r.status_code == 200
    assert r.json()["state"] == "verify", r.text

    # 读 verify_question 的标准答案
    async with factory() as db:
        s = await repo.get_session(db, sid)
        t = TutorOrchestrator()
        t.restore_state(s.context or {})
        vq = t.verify_question
        assert vq is not None, "verify_question 应从快照恢复"
        correct_ans = vq.answer

    # 答对
    r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "message", "content": f"{correct_ans}"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True
    assert body["state"] in ("done", "verify")

    # 状态接口：辅导会话不返回 qcount（修复 0/10 bug），返回 verify_question
    r = await client.get(f"/api/v1/sessions/{sid}/state", headers=h)
    st = r.json()
    assert st["qcount"] is None
    assert st["type"] == "tutor"

# ---- M4r7k：会话删除 + 完成状态 ----

async def test_session_delete_single_and_batch(client):
    """单删/批量删会话：级联消息、保留错题。"""
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)

    sids = []
    for _ in range(3):
        r = await client.post("/api/v1/sessions", json={"type": "tutor"}, headers=h)
        sids.append(r.json()["session_id"])

    # 单删
    r = await client.delete(f"/api/v1/sessions/{sids[0]}", headers=h)
    assert r.status_code == 200 and r.json()["removed"] == 1
    r = await client.get("/api/v1/sessions", headers=h)
    assert {s["id"] for s in r.json()["sessions"]} == set(sids[1:])

    # 批量删（含越权 id 不影响）
    r = await client.request("DELETE", "/api/v1/sessions", json={"ids": sids[1:] + [99999]}, headers=h)
    assert r.status_code == 200
    assert r.json()["removed"] == 2
    r = await client.get("/api/v1/sessions", headers=h)
    assert r.json()["sessions"] == []


async def test_session_status_completed_after_diagnostic(client):
    """诊断完成后会话状态自动置 completed（M4r7k）。"""
    token, uid = await _register(client)
    h = {"Authorization": f"Bearer {token}"}
    await client.put("/me/api-keys/deepseek", json={"provider": "deepseek", "api_key": "sk-secret-abcdefgh"}, headers=h)
    r = await client.post("/api/v1/sessions", json={"type": "diagnostic", "config": {"qtypes": ["choice"], "qcount": 2, "difficulty": "auto"}}, headers=h)
    sid = r.json()["session_id"]

    r = await client.get(f"/api/v1/sessions/{sid}", headers=h)
    assert r.json()["status"] == "active"

    for _ in range(2):
        r = await client.post(f"/api/v1/sessions/{sid}/messages", json={"kind": "answer", "answer": "A"}, headers=h)
        assert r.status_code == 200

    r = await client.get(f"/api/v1/sessions/{sid}", headers=h)
    assert r.json()["status"] == "completed"
