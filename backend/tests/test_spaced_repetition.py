"""SM-2 间隔重复调度测试：计算 + 存储层 + 选题优先级。"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.engine.spaced_repetition import on_answered
from app.engine.tutor_orchestrator import TutorOrchestrator
from app.persistence.db import get_session_factory
from app.persistence.models import ReviewSchedule, User
from app.persistence.repositories import (
    count_due_reviews,
    get_due_reviews,
    upsert_review,
)


def test_sm2_intervals():
    """答错重置 1 天；连续答对按 ease 递增（1→3→8→22→66）。"""
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    s, due = on_answered(False, now=now)
    assert s.repetitions == 0 and s.interval_days == 1 and s.ease == 2.3
    assert (due - now).days == 0  # 答错立即可复习

    s, due = on_answered(True, now=now)
    assert s.repetitions == 1 and s.interval_days == 3
    s, due = on_answered(True, interval_days=s.interval_days, ease=s.ease, repetitions=s.repetitions, now=now)
    assert s.interval_days == 8
    s, due = on_answered(True, interval_days=s.interval_days, ease=s.ease, repetitions=s.repetitions, now=now)
    assert s.interval_days == 22
    s, due = on_answered(True, interval_days=s.interval_days, ease=s.ease, repetitions=s.repetitions, now=now)
    assert s.interval_days == 66
    # ease 边界
    s, _ = on_answered(True, interval_days=100, ease=2.8, repetitions=9, now=now)
    assert s.ease <= 2.8
    s, _ = on_answered(False, interval_days=100, ease=1.3, repetitions=9, now=now)
    assert s.ease >= 1.3


@pytest.mark.asyncio
async def test_review_schedule_roundtrip():
    """存储层：答错入队（立即可复习）→ 答对推进 3 天 → due 查询/计数 → 清理。"""
    factory = get_session_factory()
    async with factory() as db:
        u = (await db.execute(select(User).where(User.username == "ye"))).scalar_one()
        await db.execute(
            delete(ReviewSchedule).where(
                ReviewSchedule.user_id == u.id, ReviewSchedule.qid == "smoke_sched"
            )
        )
        await db.commit()

        # 答错 → 插入且立即可复习
        r1 = await upsert_review(db, u.id, "college_english", "smoke_sched", correct=False)
        assert r1 is not None and r1.interval_days == 1 and r1.repetitions == 0
        assert await count_due_reviews(db, u.id, "college_english") == 1
        due = await get_due_reviews(db, u.id, "college_english")
        assert [x.qid for x in due] == ["smoke_sched"]

        # 答对 → SM-2 推进到 3 天（不再 due）
        r2 = await upsert_review(db, u.id, "college_english", "smoke_sched", correct=True)
        assert r2.interval_days == 3 and r2.repetitions == 1 and r2.ease == 2.6
        assert await count_due_reviews(db, u.id, "college_english") == 0

        # 再答错 → 重置立即可复习
        r3 = await upsert_review(db, u.id, "college_english", "smoke_sched", correct=False)
        assert r3.interval_days == 1 and r3.repetitions == 0 and r3.ease == 2.4
        assert await count_due_reviews(db, u.id, "college_english") == 1

        # 从未答错的题答对 → 不插入
        r4 = await upsert_review(db, u.id, "college_english", "smoke_never_wrong", correct=True)
        assert r4 is None

        await db.execute(
            delete(ReviewSchedule).where(
                ReviewSchedule.user_id == u.id,
                ReviewSchedule.qid.in_(["smoke_sched", "smoke_never_wrong"]),
            )
        )
        await db.commit()


def test_next_question_due_override_priority():
    """due_override 非空 → 优先出到期复习题（is_review=True），消费后清空。"""
    t = TutorOrchestrator("college_english")
    t.tutor_start({"qcount": 1})
    qid = t.pack.questions[0].id
    t.due_override = [qid]
    node, q = t._next_question()
    assert q is not None and q.id == qid
    assert t.is_review is True
    assert t.due_override == []  # 已消费
    # 复习题节点来自 step_node_map（错题溯源）
    assert node == next(iter(q.step_node_map.values()))


def test_next_question_due_override_unknown_qid_falls_back():
    """due_override 中的题不在包内（包已改版）→ 回退新题且不崩溃。"""
    t = TutorOrchestrator("college_english")
    t.tutor_start({"qcount": 1})
    t.due_override = ["ghost_qid_xxx"]
    node, q = t._next_question()
    assert q is not None
    assert t.is_review is False
