"""PG repository 层（对齐 docs/03-项目架构.md 2.1 persistence）。

各实体 CRUD；repository 接口保证存储可替换（PG ↔ 未来图数据库）。
async session 由调用方传入（依赖注入），本层不做连接管理。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
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

DEFAULT_PACK_ID = "junior_math_eq_ineq"


async def upsert_mastery(
    db: AsyncSession,
    student_id: int,
    node_id: str,
    mastery_p: float,
    confidence: float,
    pack_id: str = DEFAULT_PACK_ID,
) -> None:
    """BKT 掌握度 upsert（student_id, pack_id, node_id 唯一，M4r8 领域隔离）。"""
    res = await db.execute(
        select(MasteryState).where(
            MasteryState.student_id == student_id,
            MasteryState.pack_id == pack_id,
            MasteryState.node_id == node_id,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        row = MasteryState(
            student_id=student_id,
            pack_id=pack_id,
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


async def get_mastery_all(
    db: AsyncSession, student_id: int, pack_id: str = DEFAULT_PACK_ID
) -> dict[str, float]:
    res = await db.execute(
        select(MasteryState).where(
            MasteryState.student_id == student_id,
            MasteryState.pack_id == pack_id,
        )
    )
    return {row.node_id: row.mastery_p for row in res.scalars().all()}


async def list_mastery_rows(
    db: AsyncSession, student_id: int, pack_id: str = DEFAULT_PACK_ID
) -> list[MasteryState]:
    res = await db.execute(
        select(MasteryState).where(
            MasteryState.student_id == student_id,
            MasteryState.pack_id == pack_id,
        )
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
    pack_id: str = DEFAULT_PACK_ID,
) -> LearningEvent:
    ev = LearningEvent(
        student_id=student_id,
        session_id=session_id,
        pack_id=pack_id,
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


async def get_trend(
    db: AsyncSession, student_id: int, days: int = 14, pack_id: str | None = None
) -> list[dict]:
    """近 N 天每日作答事件数（M4r3 趋势图数据源，M4r8 按领域隔离）。
    M4r21i：pack_id=None 时不加领域条件（全领域学习趋势）。"""
    from datetime import timedelta

    since = _now() - timedelta(days=days)
    stmt = (
        select(
            func.date(LearningEvent.ts).label("d"),
            func.count().label("n"),
        )
        .where(
            LearningEvent.student_id == student_id,
            LearningEvent.event_type == "answer",
            LearningEvent.ts >= since,
        )
        .group_by(func.date(LearningEvent.ts))
        .order_by(func.date(LearningEvent.ts))
    )
    if pack_id is not None:
        stmt = stmt.where(LearningEvent.pack_id == pack_id)
    res = await db.execute(stmt)
    return [{"date": row.d.isoformat(), "count": row.n} for row in res.all()]


async def list_wrong_questions(
    db: AsyncSession, student_id: int, limit: int = 100, pack_id: str = DEFAULT_PACK_ID
) -> list[dict]:
    """错题集（M4r5 复盘抽卡）：取每道错题最近一次判错记录，最新在前（M4r8 按领域）。"""
    res = await db.execute(
        select(LearningEvent)
        .where(
            LearningEvent.student_id == student_id,
            LearningEvent.pack_id == pack_id,
            LearningEvent.event_type == "wrong_answer",
            LearningEvent.payload.isnot(None),
        )
        .order_by(LearningEvent.ts.desc())
    )
    seen: set[str] = set()
    out: list[dict] = []
    for ev in res.scalars().all():
        p = ev.payload or {}
        qid = p.get("qid")
        if not qid or qid in seen:
            continue
        seen.add(qid)
        out.append(
            {
                "qid": qid,
                "ts": ev.ts.isoformat(),
                "question": p.get("question", ""),
                "type": p.get("type", "blank"),
                "options": p.get("options", []),
                "user_answer": p.get("user_answer", ""),
                "correct_answer": p.get("correct_answer", ""),
                "node_id": ev.node_id,
            }
        )
        if len(out) >= limit:
            break
    return out


async def remove_wrong_question(
    db: AsyncSession, student_id: int, qid: str, pack_id: str = DEFAULT_PACK_ID
) -> bool:
    """移出错题集（"已掌握"）：删除该领域内该题全部 wrong_answer 事件。"""
    res = await db.execute(
        LearningEvent.__table__.delete().where(
            LearningEvent.student_id == student_id,
            LearningEvent.pack_id == pack_id,
            LearningEvent.event_type == "wrong_answer",
            LearningEvent.payload["qid"].astext == qid,
        )
    )
    await db.commit()
    return res.rowcount > 0


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


async def delete_sessions(
    db: AsyncSession, student_id: int, ids: list[int]
) -> int:
    """删除会话（单删/批量，M4r7k）：级联删 messages/evaluations，
    learning_events 的 session_id 置空（保留错题集数据）。"""
    if not ids:
        return 0
    from sqlalchemy import delete, update

    # 校验归属并级联删除
    await db.execute(
        delete(Message).where(
            Message.session_id.in_(ids),
            Message.session_id.in_(
                select(Session.id).where(Session.student_id == student_id)
            ),
        )
    )
    await db.execute(
        delete(Evaluation).where(
            Evaluation.session_id.in_(ids),
            Evaluation.session_id.in_(
                select(Session.id).where(Session.student_id == student_id)
            ),
        )
    )
    await db.execute(
        update(LearningEvent)
        .where(
            LearningEvent.session_id.in_(ids),
            LearningEvent.session_id.in_(
                select(Session.id).where(Session.student_id == student_id)
            ),
        )
        .values(session_id=None)
    )
    res = await db.execute(
        delete(Session).where(
            Session.student_id == student_id,
            Session.id.in_(ids),
        )
    )
    await db.commit()
    return res.rowcount or 0
