"""repository 集成测试（连真实 PG，端口 5433，适配 docker-compose.local.yml）。

需要 PG 运行：docker compose -f docker-compose.local.yml up -d postgres
每个测试创建独立测试用户，teardown 清理其全部数据。
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.persistence import repositories as repo
from app.persistence.models import (
    Evaluation,
    LearningEvent,
    MasteryState,
    Message,
    Session,
    User,
)


@pytest.fixture
async def db():
    # 独立 NullPool engine：避免连接池跨测试 event loop 复用冲突
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

    # teardown：清理该测试用户的全部数据
    async with factory() as s:
        sub = select(Session.id).where(Session.student_id == user.id)
        await s.execute(delete(Message).where(Message.session_id.in_(sub)))
        await s.execute(delete(Evaluation).where(Evaluation.session_id.in_(sub)))
        await s.execute(delete(LearningEvent).where(LearningEvent.student_id == user.id))
        await s.execute(delete(MasteryState).where(MasteryState.student_id == user.id))
        await s.execute(delete(Session).where(Session.student_id == user.id))
        await s.execute(delete(User).where(User.id == user.id))
        await s.commit()
    await engine.dispose()


async def test_session_crud(db):
    session, uid = db
    s = await repo.create_session(session, uid, "tutor")
    assert s.id > 0 and s.status == "active"

    got = await repo.get_session(session, s.id)
    assert got is not None and got.student_id == uid

    lst = await repo.list_sessions_by_student(session, uid)
    assert any(x.id == s.id for x in lst)

    await repo.update_session_status(session, s.id, "closed")
    closed = await repo.get_session(session, s.id)
    assert closed.status == "closed" and closed.ended_at is not None


async def test_message_add_list(db):
    session, uid = db
    s = await repo.create_session(session, uid, "tutor")
    await repo.add_message(session, s.id, "trace-1", "user", "我算出来是 7")
    await repo.add_message(session, s.id, "trace-2", "assistant", "再想想", 1.0)

    msgs = await repo.list_messages_by_session(session, s.id)
    assert len(msgs) == 2
    assert msgs[0].role == "user"
    assert msgs[1].purity_score == 1.0


async def test_mastery_upsert_idempotent(db):
    session, uid = db
    await repo.upsert_mastery(session, uid, "a01", 0.4, 0.5)
    await repo.upsert_mastery(session, uid, "a01", 0.7, 0.8)

    all_m = await repo.get_mastery_all(session, uid)
    assert all_m == {"a01": 0.7}

    rows = await repo.list_mastery_rows(session, uid)
    assert len(rows) == 1  # upsert 幂等，不重复插入


async def test_event_add_list(db):
    session, uid = db
    s = await repo.create_session(session, uid, "diagnostic")
    await repo.add_event(session, uid, "answer", node_id="b03", session_id=s.id, payload={"correct": False})

    evs = await repo.list_events_by_student(session, uid)
    assert any(e.event_type == "answer" and e.node_id == "b03" for e in evs)


async def test_evaluation_add_get(db):
    session, uid = db
    s = await repo.create_session(session, uid, "diagnostic")
    await repo.add_evaluation(session, s.id, "diagnosis", {"weak": ["b07"]}, {"confidence": 0.9})

    evs = await repo.get_evaluations_by_session(session, s.id)
    assert len(evs) == 1
    assert evs[0].result["weak"] == ["b07"]
