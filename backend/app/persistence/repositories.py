"""PG repository 层（对齐 docs/03-项目架构.md 2.1 persistence）。

各实体 CRUD；repository 接口保证存储可替换（PG ↔ 未来图数据库）。
async session 由调用方传入（依赖注入），本层不做连接管理。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence.models import (
    Evaluation,
    LearningEvent,
    MasteryState,
    Message,
    Session,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- sessions ----------

async def create_session(
    db: AsyncSession, student_id: int, session_type: str
) -> Session:
    s = Session(
        student_id=student_id,
        type=session_type,
        status="active",
        started_at=_now(),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def get_session(db: AsyncSession, session_id: int) -> Session | None:
    return await db.get(Session, session_id)


async def list_sessions_by_student(
    db: AsyncSession, student_id: int, limit: int = 50
) -> list[Session]:
    res = await db.execute(
        select(Session)
        .where(Session.student_id == student_id)
        .order_by(Session.started_at.desc())
        .limit(limit)
    )
    return list(res.scalars().all())


async def update_session_status(
    db: AsyncSession, session_id: int, status: str
) -> None:
    s = await db.get(Session, session_id)
    if s is None:
        return
    s.status = status
    if status in ("closed", "ended"):
        s.ended_at = _now()
    await db.commit()


# ---------- messages ----------

async def add_message(
    db: AsyncSession,
    session_id: int,
    trace_id: str,
    role: str,
    content: str,
    purity_score: float | None = None,
) -> Message:
    m = Message(
        session_id=session_id,
        trace_id=trace_id,
        role=role,
        content=content,
        purity_score=purity_score,
        created_at=_now(),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


async def list_messages_by_session(
    db: AsyncSession, session_id: int
) -> list[Message]:
    res = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    return list(res.scalars().all())


# ---------- mastery_states ----------

async def upsert_mastery(
    db: AsyncSession, student_id: int, node_id: str, mastery_p: float, confidence: float
) -> None:
    """BKT 掌握度 upsert（student_id, node_id 唯一）。"""
    res = await db.execute(
        select(MasteryState).where(
            MasteryState.student_id == student_id,
            MasteryState.node_id == node_id,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = MasteryState(
            student_id=student_id,
            node_id=node_id,
            mastery_p=mastery_p,
            confidence=confidence,
            last_review_at=_now(),
        )
        db.add(row)
    else:
        row.mastery_p = mastery_p
        row.confidence = confidence
        row.last_review_at = _now()
    await db.commit()


async def get_mastery_all(db: AsyncSession, student_id: int) -> dict[str, float]:
    res = await db.execute(
        select(MasteryState).where(MasteryState.student_id == student_id)
    )
    return {row.node_id: row.mastery_p for row in res.scalars().all()}


async def list_mastery_rows(db: AsyncSession, student_id: int) -> list[MasteryState]:
    res = await db.execute(
        select(MasteryState).where(MasteryState.student_id == student_id)
    )
    return list(res.scalars().all())


# ---------- learning_events ----------

async def add_event(
    db: AsyncSession,
    student_id: int,
    event_type: str,
    node_id: str | None = None,
    session_id: int | None = None,
    payload: dict | None = None,
) -> LearningEvent:
    ev = LearningEvent(
        student_id=student_id,
        session_id=session_id,
        event_type=event_type,
        node_id=node_id,
        payload=payload,
        ts=_now(),
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev


async def list_events_by_student(
    db: AsyncSession, student_id: int, limit: int = 200
) -> list[LearningEvent]:
    res = await db.execute(
        select(LearningEvent)
        .where(LearningEvent.student_id == student_id)
        .order_by(LearningEvent.ts.desc())
        .limit(limit)
    )
    return list(res.scalars().all())


# ---------- evaluations ----------

async def add_evaluation(
    db: AsyncSession,
    session_id: int,
    eval_type: str,
    result: dict,
    detail: dict | None = None,
) -> Evaluation:
    ev = Evaluation(
        session_id=session_id,
        eval_type=eval_type,
        result=result,
        detail=detail,
        ts=_now(),
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev


async def get_evaluations_by_session(
    db: AsyncSession, session_id: int
) -> list[Evaluation]:
    res = await db.execute(
        select(Evaluation)
        .where(Evaluation.session_id == session_id)
        .order_by(Evaluation.ts)
    )
    return list(res.scalars().all())
