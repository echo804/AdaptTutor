"""会话路由：创建/消息/详情（对齐 03 5.1）。

AI 功能门槛：require_ai_access（未配 key 403）。
会话状态经 session_service 落库（M3），每轮 restore → 操作 → save → persist。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_ai_access
from app.api.routes_domains import _active_pack
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


def _new_orchestrator(pack_id: str | None = None) -> TutorOrchestrator:
    """构造辅导引擎；pack_id 为空时回退系统默认领域包（M4r8）。"""
    from app.config import get_settings

    return TutorOrchestrator(pack_id or get_settings().active_domain_pack)


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
    pack_id = body.pack_id or _active_pack(user)
    t = _new_orchestrator(pack_id)
    first: str | None = None
    question: dict | None = None
    if body.type == "tutor":
        r = t.tutor_start(body.config)
        first = r.message
        # M4r21：辅导会话创建时返回当前题目（verify_question），前端才能渲染作答组件
        question = _question_to_dict(t.verify_question)
    elif body.type == "diagnostic":
        st = t.start_diagnosis(body.config)
        q = st.get("question")
        question = _question_to_dict(q)
        first = f"开始诊断。第一题：{q.content}" if q else "开始诊断。"
        if st.get("done"):
            raise HTTPException(status_code=400, detail="当前配置下无可用题目（题型/难度筛选后为空）")
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
        qcount=st.get("qcount") if body.type == "diagnostic" else None,
        answered=st.get("answered") if body.type == "diagnostic" else None,
    )


@router.get("/sessions", response_model=SessionList)
async def api_list_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionList:
    """会话列表（M4r3 仪表盘"最近会话"数据源）。"""
    rows = await session_service.list_sessions(db, user.id)
    return SessionList(sessions=rows)


class SessionDeleteRequest(BaseModel):
    ids: list[int] = Field(min_length=1)


@router.delete("/sessions/{sid}")
async def api_delete_session(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """删除单个会话（M4r7k）。"""
    await _own_session(db, sid, user.id)
    n = await repo.delete_sessions(db, user.id, [sid])
    return {"removed": n}


@router.delete("/sessions")
async def api_delete_sessions_batch(
    body: SessionDeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """批量删除会话（M4r7k）。"""
    n = await repo.delete_sessions(db, user.id, body.ids)
    return {"removed": n}


@router.post("/sessions/{sid}/messages", response_model=MessageReply)
async def api_send_message(
    sid: int,
    body: MessageSendRequest,
    user: User = Depends(require_ai_access),
    db: AsyncSession = Depends(get_db),
) -> MessageReply:
    s = await _own_session(db, sid, user.id)
    state = s.context or {}
    # M4r8：按会话快照的领域包恢复（切领域后旧会话仍可继续）
    t = _new_orchestrator(state.get("pack_id"))
    t.restore_state(state)
    pack_id = state.get("pack_id") or "junior_math_eq_ineq"

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
        # M4r7f：无法判定（非答案输入）→ 温和提示重答，不推进诊断
        if result.indeterminate:
            reply = MessageReply(
                state="diagnose",
                message=result.feedback,
                degraded=True,
                mock=True,
                correct=False,
                feedback=result.feedback,
                judge_method="rule",
            )
        else:
            st = t.diagnose(result.correct)
            nq = st.get("question")
            # M4r5：判错 → 落库错题集（复盘抽卡数据源）
            if not result.correct:
                await repo.add_event(
                    db,
                    user.id,
                    "wrong_answer",
                    node_id=next(iter(q.step_node_map.values()), None),
                    session_id=sid,
                    pack_id=pack_id,
                    payload={
                        "qid": q.id,
                        "question": q.content,
                        "type": q.type,
                        "options": q.options,
                        "user_answer": body.answer,
                        "correct_answer": result.correct_answer or q.answer,
                    },
                )
            if st.get("done"):
                # M4r7j：诊断完成总结（引导下一步），不再只写"（诊断完成）"
                if not t.weak_nodes:
                    t.build_path()  # 诊断后生成薄弱路径（供总结与仪表盘）
                weak = "、".join((t.weak_nodes or [])[:3]) or "—"
                answered = st.get("answered") or 0
                reply_text = (
                    f"🎉 诊断完成！共诊断 {answered} 题。"
                    f"薄弱知识点：{weak}。推荐学习路径已生成，"
                    "可去仪表盘查看，或开始辅导练习巩固。"
                )
            else:
                reply_text = (
                    f"答对了！{result.feedback} 下一题：{nq.content}"
                    if result.correct
                    else f"答错了。{result.feedback} 下一题：{nq.content}"
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
                correct_answer=None if result.correct else result.correct_answer,
                qcount=st.get("qcount"),
                answered=st.get("answered"),
            )
    else:
        # M4r7f：辅导会话作答自动判题——ELICIT（初题作答）/ VERIFY（变式验证）用户消息视为作答
        from app.engine.evaluator import judge as judge_answer
        from app.engine.state_machine.states import State as SMState

        if t.sm.state in (SMState.ELICIT, SMState.VERIFY) and t.verify_question and (body.content or "").strip():
            j = judge_answer(body.content, t.verify_question)
            if j.indeterminate and t.sm.state == SMState.VERIFY:
                # M4r7f：VERIFY 非答案输入（"好"等）→ 温和提示重答，不推进状态机
                reply = MessageReply(
                    state="verify",
                    message=j.feedback,
                    degraded=True,
                    mock=True,
                    correct=False,
                    feedback=j.feedback,
                    judge_method="rule",
                    question=_question_to_dict(t.verify_question),
                )
            elif j.indeterminate:
                # ELICIT 非答案（说思路/闲聊）→ 正常对话流转（"先说说你的思路"）
                r = t.tutor_step(body.content, correct=None)
                reply = MessageReply(
                    state=r.state, message=r.message, degraded=r.degraded, mock=r.mock,
                    question=_question_to_dict(t.verify_question),
                )
            else:
                r = t.tutor_step(body.content, correct=j.correct)
                judge_line = (
                    f"✓ 答对了！{j.feedback}"
                    if j.correct
                    else f"✗ 答错了。{j.feedback} 正确答案：{j.correct_answer or t.verify_question.answer}"
                )
                reply = MessageReply(
                    state=r.state,
                    message=f"{judge_line}\n{r.message}",
                    degraded=r.degraded,
                    mock=r.mock,
                    correct=j.correct,
                    feedback=j.feedback,
                    judge_method=j.method,
                    correct_answer=None if j.correct else j.correct_answer,
                    question=_question_to_dict(t.verify_question),
                )
        else:
            r = t.tutor_step(body.content or "", correct=body.correct)
            reply = MessageReply(
                state=r.state, message=r.message, degraded=r.degraded, mock=r.mock,
                question=_question_to_dict(t.verify_question),
            )

    # 掌握度快照落库（mastery_states，供仪表盘真实数据）
    for node_id, p in t.mastery.items():
        await repo.upsert_mastery(db, user.id, node_id, p, 1 - min(t.mastery.values()), pack_id)

    # M4r7k：诊断完成 / 辅导完成 → 会话状态自动置 completed
    is_finished = (s.type == "diagnostic" and reply.done) or (
        s.type == "tutor" and reply.state == "done"
    )
    if is_finished:
        await repo.update_session_status(db, sid, "completed")

    await session_service.persist_session_state(db, sid, t.save_state())
    await repo.add_message(db, sid, trace_id, "assistant", reply.message, None)
    return reply


@router.get("/graph", response_model=dict)
async def api_graph(
    pack_id: str | None = None,
    user: User = Depends(get_current_user),
) -> dict:
    """领域包图谱（M4 前端可视化用，需登录）；pack_id 默认用户激活包。"""
    t = _new_orchestrator(pack_id or _active_pack(user))
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


@router.get("/sessions/{sid}/state")
async def api_session_state(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """会话当前状态（M4r5b 前端"继续会话"）：恢复快照返回当前题/进度/阶段。"""
    s = await _own_session(db, sid, user.id)
    t = _new_orchestrator((s.context or {}).get("pack_id"))
    t.restore_state(s.context or {})
    q = t.current_question
    is_diag = s.type == "diagnostic"
    return {
        "session_id": sid,
        "type": s.type,
        "status": s.status,
        "state": t.sm.state.value if t.sm.state else "diagnose",
        "question": _question_to_dict(q),
        # M4r7f：诊断才返回题数进度；辅导返回变式题（VERIFY 判题对象）
        "qcount": t.diag_config.get("qcount") if is_diag else None,
        "answered": sum(t.answered_counts.values()) if is_diag else None,
        "verify_question": _question_to_dict(t.verify_question) if not is_diag else None,
        "done": q is None,
    }


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
