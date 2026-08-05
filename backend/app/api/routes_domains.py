"""领域路由：包列表 + 用户激活偏好（M4r8 多领域支持）。

- GET /api/v1/domains：可用领域包列表 + 当前用户激活包
- PUT /me/active-pack：切换用户激活领域（进度按 pack 隔离）
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.config import get_settings
from app.domain.loader import list_packs
from app.persistence.models import User

router = APIRouter(prefix="/api/v1", tags=["domains"])


def _active_pack(user: User) -> str:
    return (user.meta or {}).get("active_pack") or get_settings().active_domain_pack


@router.get("/domains")
async def api_domains(user: User = Depends(get_current_user)) -> dict:
    """可用领域包列表 + 当前激活包。"""
    return {"packs": list_packs(), "active": _active_pack(user)}


class ActivePackRequest(BaseModel):
    pack_id: str = Field(min_length=1, max_length=64)


@router.put("/me/active-pack")
async def api_set_active_pack(
    body: ActivePackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """切换用户激活领域（校验包存在；进度数据按 pack 隔离互不干扰）。"""
    if body.pack_id not in {p["id"] for p in list_packs()}:
        raise HTTPException(status_code=404, detail="领域包不存在")
    meta = dict(user.meta or {})
    meta["active_pack"] = body.pack_id
    user.meta = meta
    await db.commit()
    return {"active": body.pack_id}
