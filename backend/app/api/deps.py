"""FastAPI 依赖注入：DB 会话、当前用户、AI 功能门槛。"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_token
from app.auth.service import get_user_by_id
from app.persistence.db import get_session_factory
from app.persistence.models import User
from app.persistence import repositories as repo


async def get_db() -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Bearer JWT → 当前用户（无效/缺失 → 401）。"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(status_code=401, detail="登录凭证无效或已过期") from None
    user = await get_user_by_id(db, int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


async def require_ai_access(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """AI 功能门槛（对齐 04 v0.4：强制自配 key，未配 403）。

    会话创建/消息等 AI 接口调用；未配任何供应商 key → 403。
    """
    has = await _user_has_key(db, user.id)
    if not has:
        raise HTTPException(
            status_code=403,
            detail="未配置 LLM API key，请先在设置页配置",
        )
    return user


async def _user_has_key(db: AsyncSession, user_id: int) -> bool:
    from sqlalchemy import select

    from app.persistence.models import UserApiKey

    res = await db.execute(
        select(UserApiKey.id).where(UserApiKey.user_id == user_id).limit(1)
    )
    return res.scalar_one_or_none() is not None
