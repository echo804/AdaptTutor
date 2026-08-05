"""会话路由：创建/消息/详情（对齐 03 5.1）。

AI 功能门槛：require_ai_access（未配 key 403）。
会话状态经 session_service 落库（M3），每轮 restore → 操作 → save → persist。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_ai_access
from app.api.schemas import (
    MessageOut,
    MessageReply,
    MessageSendRequest,
    SessionCreated,
    SessionCreateRequest,
    SessionDetail,
    SessionList,
)
from app.domain.schemas import Question
from app.engine.tutor_orchestrator import TutorOrchestrator
from app.persistence import repositories as repo
from app.persistence import session_service
from app.persistence.models import Session, User

router = APIRouter(prefix="/api/v1", tags=["sessions"])

# MVP：固定领域包（M4 阶段；后续可参数化选择）
PACK_ID = "junior_math_eq_ineq"


def _question_to_dict(q: Question | None) -> dict | None:
    if q is None:
        return None
    return {
        "id": q.id,
        "type": q.type,
        "content": q.content,
        "options": q.options,
        "difficulty": q.difficulty,
    }


def _new_orchestrator() -> TutorOrchestrator:
    return TutorOrchestrator(PACK_ID)


async def _own_session(db: AsyncSession, sid: int, user_id: int) -> Session:
    s = await repo.get_session(db, sid)
    if s is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if s.student_id != user_id:
        raise HTTPException(status_code=403, detail="无权访问该会话")
    return s


@router.post("/sessions", response_model=SessionCreated)
async def api_create_session(
    body: SessionCreateRequest,
    user: User = Depends(require_ai_access),
    db: AsyncSession = Depends(get_db),
) -> SessionCreated:
    t = _new_orchestrator()
    first: str | None = None
    question: dict | None = None
    if body.type == "tutor":
        r = t.tutor_start()
        first = r.message
    elif body.type == "diagnostic":
        st = t.start_diagnosis()
        q = st.get("question")
        question = _question_to_dict(q)
        first = f"开始诊断。第一题：{q.content}" if q else "开始诊断。"
    # 诊断首次选题后即可用
    s = await session_service.create_session_with_state(
        db, user.id, body.type, t.save_state()
    )
    return SessionCreated(
        session_id=s.id,
        type=body.type,
        status=s.status,
        first_message=first,
        question=question,
    )


@router.get("/sessions", response_model=SessionList)
async def api_list_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionList:
    """会话列表（M4r3 仪表盘"最近会话"数据源）。"""
    rows = await session_service.list_sessions(db, user.id)
    return SessionList(sessions=rows)


@router.post("/sessions/{sid}/messages", response_model=MessageReply)
async def api_send_message(
    sid: int,
    body: MessageSendRequest,
    user: User = Depends(require_ai_access),
    db: AsyncSession = Depends(get_db),
) -> MessageReply:
    s = await _own_session(db, sid, user.id)
    state = s.context or {}
    t = _new_orchestrator()
    t.restore_state(state)

    trace_id = f"{sid}-{uuid.uuid4().hex[:8]}"
    await repo.add_message(
        db,
        sid,
        trace_id,
        "user",
        body.answer or body.content or "",
        None,
    )

    if body.kind == "answer":
        q = t.current_question
        if q is None or not body.answer:
            raise HTTPException(status_code=400, detail="缺少作答内容")
        # M4r1：AI 判题（choice 比对 / open LLM+规则兜底），用户不再自判
        from app.engine.evaluator import judge

        result = judge(body.answer, q)
        st = t.diagnose(result.correct)
        nq = st.get("question")
        reply_text = (
            f"答对了！{result.feedback} 下一题：{nq.content}"
            if result.correct
            else f"答错了。{result.feedback} 下一题：{nq.content if nq else '（诊断完成）'}"
        )
        reply = MessageReply(
            state="diagnose",
            message=reply_text,
            question=_question_to_dict(nq),
            terminated=bool(st.get("terminated", False)),
            done=bool(st.get("done", False)),
            correct=result.correct,
            feedback=result.feedback,
            judge_method=result.method,
        )
    else:
        r = t.tutor_step(body.content or "", correct=body.correct)
        reply = MessageReply(
            state=r.state, message=r.message, degraded=r.degraded, mock=r.mock
        )

    # 掌握度快照落库（mastery_states，供仪表盘真实数据）
    for node_id, p in t.mastery.items():
        await repo.upsert_mastery(db, user.id, node_id, p, 1 - min(t.mastery.values()))

    await session_service.persist_session_state(db, sid, t.save_state())
    await repo.add_message(db, sid, trace_id, "assistant", reply.message, None)
    return reply


@router.get("/graph", response_model=dict)
async def api_graph(
    user: User = Depends(get_current_user),
) -> dict:
    """领域包图谱（M4 前端可视化用，需登录）。"""
    t = _new_orchestrator()
    return {
        "nodes": [
            {"id": n.id, "name": n.name, "difficulty": n.difficulty, "importance": n.importance}
            for n in t.pack.graph.nodes
        ],
        "edges": [
            {"from": e.from_, "to": e.to, "type": e.type} for e in t.pack.graph.edges
        ],
    }


@router.get("/sessions/{sid}", response_model=SessionDetail)
async def api_session_detail(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    s = await _own_session(db, sid, user.id)
    state = s.context or {}
    return SessionDetail(
        session_id=s.id,
        type=s.type,
        status=s.status,
        state=state.get("sm", {}).get("state"),
        context=state,
    )


@router.get("/sessions/{sid}/messages", response_model=list[MessageOut])
async def api_session_messages(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    await _own_session(db, sid, user.id)
    msgs = await repo.list_messages_by_session(db, sid)
    return [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            trace_id=m.trace_id,
            created_at=m.created_at.isoformat(),
        )
        for m in msgs
    ]
