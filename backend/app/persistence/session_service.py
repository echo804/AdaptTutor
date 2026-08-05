"""会话持久化服务（M3：会话恢复 100%，对齐 02 计划 F3 验收）。

状态快照存于 sessions.context（JSONB），结构：
{
  "sm": {"state": "...", "context": {...}},   # 状态机 to_dict()
  "mastery": {node_id: p},                    # BKT 掌握度
  "path": [...],                              # 学习路径
  "weak_nodes": [...],
  "answered_counts": {node_id: n},
  "pack_id": "...",
}
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.persistence import repositories as repo
from app.persistence.models import Session


async def create_session_with_state(
    db: AsyncSession,
    student_id: int,
    session_type: str,
    state: dict,
) -> Session:
    """创建会话并写入状态快照。"""
    s = await repo.create_session(db, student_id, session_type)
    s.context = state
    await db.commit()
    await db.refresh(s)
    return s


async def persist_session_state(
    db: AsyncSession, session_id: int, state: dict
) -> None:
    """更新会话状态快照（每轮后调用）。"""
    s = await repo.get_session(db, session_id)
    if s is None:
        raise ValueError(f"session {session_id} 不存在")
    s.context = state
    await db.commit()


async def load_session_state(
    db: AsyncSession, session_id: int
) -> dict | None:
    """读取状态快照；无快照返回 None。"""
    s = await repo.get_session(db, session_id)
    return s.context if s is not None else None
