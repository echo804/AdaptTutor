"""领域路由：包列表 + 用户激活偏好 + 用户可见自建领域（M4r8/d）。

- GET /api/v1/domains：系统预置包 + 用户可见自建领域 + 当前激活包
- PUT /me/active-pack：切换用户激活领域（进度按 pack 隔离）
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.config import get_settings
from app.domain.loader import list_packs
from app.persistence.models import User, UserDomain

router = APIRouter(prefix="/api/v1", tags=["domains"])


def _active_pack(user: User) -> str:
    return (user.meta or {}).get("active_pack") or get_settings().active_domain_pack


@router.get("/domains")
async def api_domains(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """可用领域包列表 + 当前激活包。

    packs = 系统预置包 + 用户可见的自建领域：
    - 自己的（已发布/待审核/驳回可见，草稿生成中也可见但标记 generating）
    - 他人的已发布公开领域
    """
    packs: list[dict] = list_packs()
    known = {p["id"] for p in packs}
    res = await db.execute(
        select(UserDomain).where(
            UserDomain.status.in_(["published", "pending_review", "rejected", "draft", "takedown"])
        )
    )
    for d in res.scalars().all():
        # 生成中（draft）的包目录可能未就绪，不进选择器（用户在"我的领域"页看进度）
        if d.status == "draft":
            continue
        visible = d.user_id == user.id or (d.visibility == "public" and d.status == "published")
        if not visible:
            continue
        if d.pack_id in known:
            continue
        # 选择器直接显示领域名（他人公开领域同样只显示名称，简洁不标注可见性）
        packs.append(
            {
                "id": d.pack_id,
                "subject": d.name,
                "version": "0.1.0",
                "owner": d.user_id == user.id,
                "status": d.status,
            }
        )
    return {"packs": packs, "active": _active_pack(user)}


class ActivePackRequest(BaseModel):
    pack_id: str = Field(min_length=1, max_length=64)


@router.put("/me/active-pack")
async def api_set_active_pack(
    body: ActivePackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """切换用户激活领域（校验包存在；进度数据按 pack 隔离互不干扰）。"""
    # 校验：系统包 或 用户可见自建领域
    if body.pack_id in {p["id"] for p in list_packs()}:
        pass
    else:
        res = await db.execute(select(UserDomain).where(UserDomain.pack_id == body.pack_id))
        d = res.scalar_one_or_none()
        visible = d is not None and (
            d.user_id == user.id or (d.visibility == "public" and d.status == "published")
        )
        if not visible:
            raise HTTPException(status_code=404, detail="领域包不存在")
    meta = dict(user.meta or {})
    meta["active_pack"] = body.pack_id
    user.meta = meta
    await db.commit()
    return {"active": body.pack_id}
