"""认证服务：注册（邀请码校验+一次性消费）、登录、当前用户解析。

对齐 docs/03-项目架构.md 5.0（POST /auth/login、/auth/register、GET /auth/me）。
邀请码：CLI 生成（scripts/gen_invite.py）、一次性（used_at 置位）、过期失效（expires_at）。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password, verify_password
from app.persistence.models import InviteCode, User


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def register(
    db: AsyncSession, username: str, password: str, invite_code: str
) -> User:
    """注册：校验邀请码 → 用户名唯一 → 建用户 → 消费邀请码。"""
    username = username.strip()
    if len(username) < 2 or len(username) > 64:
        raise ValueError("用户名长度须在 2-64 之间")
    if len(password) < 6:
        raise ValueError("密码长度至少 6 位")

    res = await db.execute(select(InviteCode).where(InviteCode.code == invite_code.strip()))
    code = res.scalar_one_or_none()
    if code is None:
        raise ValueError("邀请码无效")
    if code.used_at is not None:
        raise ValueError("邀请码已被使用")
    if code.expires_at < _now():
        raise ValueError("邀请码已过期")

    res = await db.execute(select(User).where(User.username == username))
    if res.scalar_one_or_none() is not None:
        raise ValueError("用户名已存在")

    user = User(
        username=username,
        password_hash=hash_password(password),
        created_at=_now(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # 一次性消费邀请码
    code.used_by = user.id
    code.used_at = _now()
    await db.commit()
    return user


async def login(db: AsyncSession, username: str, password: str) -> User:
    res = await db.execute(select(User).where(User.username == username.strip()))
    user = res.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise ValueError("用户名或密码错误")
    return user


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)
