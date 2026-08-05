"""用户 API key 路由：/me/api-keys（对齐 03 5.0，仅掩码回读）+ 百炼模型偏好。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.schemas import BailianModel, KeyItem, KeyPutRequest, SettingsPutRequest
from app.keys import service as key_service
from app.persistence.models import User

router = APIRouter(prefix="/me/api-keys", tags=["keys"])

# 阿里云百炼（DashScope）可选模型：百炼免费额度常用模型（LiteLLM dashscope/ 前缀）
BAILIAN_MODELS: list[dict] = [
    {"id": "dashscope/qwen-turbo", "label": "通义千问 qwen-turbo（速度快，适合出题）"},
    {"id": "dashscope/qwen-plus", "label": "通义千问 qwen-plus"},
    {"id": "dashscope/qwen-max", "label": "通义千问 qwen-max（能力最强）"},
    {"id": "dashscope/qwen-long", "label": "通义千问 qwen-long（长文本）"},
    {"id": "dashscope/deepseek-v3", "label": "DeepSeek V3（百炼托管）"},
    {"id": "dashscope/deepseek-r1", "label": "DeepSeek R1（百炼托管）"},
]

DEFAULT_BAILIAN_MODELS = {
    "tutor": "dashscope/qwen-turbo",
    "generate": "dashscope/qwen-turbo",
}


@router.get("/bailian/models", response_model=list[BailianModel])
async def list_bailian_models(
    user: User = Depends(get_current_user),
) -> list[BailianModel]:
    return [BailianModel(**m) for m in BAILIAN_MODELS]


@router.put("/settings", response_model=dict)
async def put_settings(
    body: SettingsPutRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """保存模型偏好（users.meta，百炼格模型下拉）。"""
    meta = dict(user.meta or {})
    if body.bailian_models is not None:
        meta["bailian_models"] = body.bailian_models
    user.meta = meta
    await db.commit()
    return {"saved": True, "bailian_models": body.bailian_models or DEFAULT_BAILIAN_MODELS}


@router.get("/settings", response_model=dict)
async def get_settings(
    user: User = Depends(get_current_user),
) -> dict:
    meta = user.meta or {}
    return {"bailian_models": meta.get("bailian_models", DEFAULT_BAILIAN_MODELS)}


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
