"""用户 API key 路由：/me/api-keys（对齐 03 5.0，仅掩码回读）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.schemas import KeyItem, KeyPutRequest
from app.keys import service as key_service
from app.persistence.models import User

router = APIRouter(prefix="/me/api-keys", tags=["keys"])


@router.get("", response_model=list[KeyItem])
async def list_keys(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[KeyItem]:
    return [KeyItem(**k) for k in await key_service.list_user_keys(db, user.id)]


@router.put("/{provider}", response_model=KeyItem)
async def put_key(
    provider: str,
    body: KeyPutRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> KeyItem:
    if provider != body.provider:
        raise HTTPException(status_code=400, detail="路径与请求体 provider 不一致")
    await key_service.set_user_key(db, user.id, body.provider, body.api_key)
    keys = await key_service.list_user_keys(db, user.id)
    return next(k for k in keys if k["provider"] == provider)


@router.delete("/{provider}", status_code=204)
async def delete_key(
    provider: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    ok = await key_service.delete_user_key(db, user.id, provider)
    if not ok:
        raise HTTPException(status_code=404, detail="未配置该供应商 key")
