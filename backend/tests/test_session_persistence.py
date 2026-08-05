"""会话持久化与恢复测试（M3：会话恢复 100%）。

1) 纯内存：save_state → restore_state 状态一致
2) PG 集成：persist → 新引擎 load → 重建一致（模拟重启不丢）
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.engine.tutor_orchestrator import TutorOrchestrator
from app.engine.state_machine.states import State
from app.persistence import repositories as repo
from app.persistence.models import Session, User
from app.persistence.session_service import (
    create_session_with_state,
    load_session_state,
    persist_session_state,
)


def _run_progress(t) -> None:
    """跑一段确定性的辅导进度（诊断 2 题 + 辅导 2 轮）。"""
    t.diagnose(True)
    t.diagnose(False)
    t.build_path()
    t.tutor_start()
    t.tutor_step("我算出来是 7。", correct=False)


# ---- 纯内存往返 ----

def test_save_restore_roundtrip():
    t1 = TutorOrchestrator()
    _run_progress(t1)
    state = t1.save_state()

    t2 = TutorOrchestrator()
    t2.restore_state(state)

    assert t2.sm.state == t1.sm.state
    assert t2.sm.context == t1.sm.context
    assert t2.mastery == t1.mastery
    assert t2.path == t1.path
    assert t2.weak_nodes == t1.weak_nodes
    assert t2.answered_counts == t1.answered_counts


def test_restore_continues_flow():
    """恢复后状态机可继续推进（非 DONE/初始）。"""
    t1 = TutorOrchestrator()
    _run_progress(t1)
    t2 = TutorOrchestrator()
    t2.restore_state(t1.save_state())
    assert t2.sm.state != State.ELICIT  # 已推进过
    r = t2.tutor_step("我不确定第一步做什么。", correct=False)
    assert r.message  # 可继续交互


def test_restore_rejects_wrong_pack():
    t1 = TutorOrchestrator()
    state = t1.save_state()
    state["pack_id"] = "other_pack"
    with pytest.raises(ValueError):
        TutorOrchestrator().restore_state(state)


# ---- PG 集成（重启不丢） ----

@pytest.fixture
async def pg_user():
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        username = f"t_{uuid.uuid4().hex[:8]}"
        user = User(
            username=username,
            password_hash="x",
            created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        yield session, user.id
    async with factory() as s:
        await s.execute(delete(Session).where(Session.student_id == user.id))
        await s.execute(delete(User).where(User.id == user.id))
        await s.commit()
    await engine.dispose()


async def test_persist_and_recover_100pct(pg_user):
    """保存→（模拟重启）→读取→重建：状态/掌握度/路径完全一致（恢复 100%）。"""
    session, uid = pg_user

    # 阶段 1：跑进度并持久化
    t1 = TutorOrchestrator()
    _run_progress(t1)
    state1 = t1.save_state()
    s = await create_session_with_state(session, uid, "tutor", state1)
    sid = s.id

    # 阶段 2：模拟重启——完全新建引擎，从 PG 读回
    state2 = await load_session_state(session, sid)
    assert state2 is not None
    t2 = TutorOrchestrator()
    t2.restore_state(state2)

    assert t2.sm.state == t1.sm.state
    assert t2.sm.context == t1.sm.context
    assert t2.mastery == t1.mastery
    assert t2.path == t1.path

    # 阶段 3：恢复后可继续推进（闭环不中断）
    r = t2.tutor_step("我再想想。", correct=True)
    assert r.message

    # 阶段 4：再持久化更新
    await persist_session_state(session, sid, t2.save_state())
    state3 = await load_session_state(session, sid)
    assert state3["sm"]["state"] == t2.sm.state.value


async def test_session_list_and_status(pg_user):
    session, uid = pg_user
    s = await create_session_with_state(session, uid, "diagnostic", {"sm": {}})
    lst = await repo.list_sessions_by_student(session, uid)
    assert any(x.id == s.id for x in lst)
    await repo.update_session_status(session, s.id, "closed")
    closed = await repo.get_session(session, s.id)
    assert closed.status == "closed"
