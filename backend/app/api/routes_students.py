"""学生数据路由：掌握度快照 / 推荐路径 / 错题溯源（对齐 03 5.2）。

数据源：mastery_states 表（API 层每轮作答后 upsert，供仪表盘真实数据）。
越权：{id} 必须等于当前登录用户（用户即学习者），否则 403。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.schemas import MasteryOut, PathOut, TraceOut
from app.api.routes_domains import _active_pack
from app.api.routes_sessions import _new_orchestrator
from app.engine.graph_engine import KnowledgeGraph, plan_path, trace_root_evidenced
from app.engine.tutor_orchestrator import TutorOrchestrator
from app.persistence import repositories as repo
from app.persistence.models import User

router = APIRouter(prefix="/api/v1/students", tags=["students"])


def _check_self(user_id: int, path_id: int) -> None:
    if user_id != path_id:
        raise HTTPException(status_code=403, detail="无权访问他人数据")


@router.get("/{sid}/mastery", response_model=MasteryOut)
async def api_mastery(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    pack_id: str | None = None,
) -> MasteryOut:
    _check_self(user.id, sid)
    pid = pack_id or _active_pack(user)
    mastery = await repo.get_mastery_all(db, user.id, pid)
    weakest = min(mastery, key=mastery.get) if mastery else None
    return MasteryOut(mastery=mastery, weakest=weakest)


@router.get("/{sid}/path", response_model=PathOut)
async def api_path(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    pack_id: str | None = None,
) -> PathOut:
    _check_self(user.id, sid)
    pid = pack_id or _active_pack(user)
    t: TutorOrchestrator = _new_orchestrator(pid)
    mastery = await repo.get_mastery_all(db, user.id, pid)
    if not mastery:
        return PathOut(path=[])
    t.mastery.update(mastery)
    return PathOut(path=t.build_path())


@router.get("/{sid}/trace/{node_id}", response_model=TraceOut)
async def api_trace(
    sid: int,
    node_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    pack_id: str | None = None,
) -> TraceOut:
    _check_self(user.id, sid)
    pid = pack_id or _active_pack(user)
    mastery = await repo.get_mastery_all(db, user.id, pid)
    if node_id not in mastery:
        raise HTTPException(status_code=404, detail="未知节点或尚未诊断该节点")
    t = _new_orchestrator(pid)
    t.mastery.update(mastery)
    graph = KnowledgeGraph(t.pack.graph)
    chain = sorted(graph.ancestors(node_id))
    root = trace_root_evidenced(graph, node_id, mastery, answered=set(mastery))
    return TraceOut(wrong_node=node_id, root=root, chain=chain)


@router.get("/{sid}/trend")
async def api_trend(
    sid: int,
    days: int = 14,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    pack_id: str | None = None,
) -> dict:
    """学习趋势（M4r3）：近 N 天每日作答事件数（learning_events，event_type='answer'）。
    M4r21i：pack_id='*' 时显示该用户全领域作答（学习趋势是整体活跃度，不分领域）。"""
    _check_self(user.id, sid)
    if pack_id == "*":
        rows = await repo.get_trend(db, user.id, days)  # 不传 pack → 全领域
    else:
        rows = await repo.get_trend(db, user.id, days, pack_id or _active_pack(user))
    return {"trend": rows}


@router.get("/{sid}/wrong-questions")
async def api_wrong_questions(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    pack_id: str | None = None,
) -> dict:
    """错题集（M4r5 复盘抽卡）：按题去重，最新判错在前（M4r8 按领域）。"""
    _check_self(user.id, sid)
    return {"items": await repo.list_wrong_questions(db, user.id, pack_id=pack_id or _active_pack(user))}


@router.delete("/{sid}/wrong-questions/{qid}")
async def api_remove_wrong_question(
    sid: int,
    qid: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    pack_id: str | None = None,
) -> dict:
    """移出错题集（"已掌握"）。"""
    _check_self(user.id, sid)
    ok = await repo.remove_wrong_question(db, user.id, qid, pack_id or _active_pack(user))
    if not ok:
        raise HTTPException(status_code=404, detail="该错题不存在或已移除")
    return {"removed": qid}
