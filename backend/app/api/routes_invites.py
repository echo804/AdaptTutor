"""邀请码管理 API（M4r19 → M6.1 收紧）：仅管理员可生成邀请码。
原设计：每个用户可生成邀请码邀请朋友（多用户平权）；
收紧原因：公网引流后防止任意用户随意扩散邀请码，生成权收敛给管理员。
限制：管理员同时最多持有 MAX_ACTIVE=5 个未使用邀请码；默认 7 天有效期；一次性。
历史已生成的邀请码不受影响（仍可用）；普通用户可查看/作废自己生成的历史码。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.persistence.models import InviteCode, User

router = APIRouter(prefix="/me/invite-codes", tags=["invites"])

MAX_ACTIVE = 5      # 同时最多持有的未使用邀请码
DEFAULT_DAYS = 7    # 默认有效期（天）


def _is_admin(user: User) -> bool:
    return bool((user.meta or {}).get("is_admin"))


@router.post("")
async def create_invite(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """生成一个邀请码（仅管理员）。超出持有上限 → 400；非管理员 → 403。"""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可生成邀请码")
    now = datetime.now(timezone.utc)
    active = (
        await db.execute(
            select(InviteCode.id).where(
                InviteCode.created_by == user.id,
                InviteCode.used_at.is_(None),
                InviteCode.expires_at > now,
            )
        )
    ).scalars().all()
    if len(active) >= MAX_ACTIVE:
        raise HTTPException(
            status_code=400,
            detail=f"最多同时持有 {MAX_ACTIVE} 个未使用邀请码，请先作废旧的",
        )

    code = InviteCode(
        code=token_urlsafe(8),
        created_by=user.id,
        created_at=now,
        expires_at=now + timedelta(days=DEFAULT_DAYS),
    )
    db.add(code)
    await db.commit()
    await db.refresh(code)
    return {
        "id": code.id,
        "code": code.code,
        "expires_at": code.expires_at.isoformat(),
    }


@router.get("")
async def list_invites(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """列出自己生成的全部邀请码（含已用/已过期，便于管理）。"""
    res = await db.execute(
        select(InviteCode)
        .where(InviteCode.created_by == user.id)
        .order_by(InviteCode.created_at.desc())
    )
    items = []
    now = datetime.now(timezone.utc)
    for c in res.scalars().all():
        items.append(
            {
                "id": c.id,
                "code": c.code,
                "created_at": c.created_at.isoformat(),
                "expires_at": c.expires_at.isoformat(),
                "used": c.used_at is not None,
                "expired": c.used_at is None and c.expires_at < now,
            }
        )
    return {"items": items}


@router.delete("/{code_id}")
async def revoke_invite(
    code_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """作废自己生成的未使用邀请码（置为过期）。"""
    code = await db.get(InviteCode, code_id)
    if code is None or code.created_by != user.id:
        raise HTTPException(status_code=404, detail="邀请码不存在")
    if code.used_at is not None:
        raise HTTPException(status_code=400, detail="已被使用的邀请码不可作废")
    code.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.commit()
    return {"ok": True}
