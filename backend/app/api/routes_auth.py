"""auth 路由：/auth/login、/auth/register、/auth/me（对齐 03 5.0）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.api.schemas import (
    AuthResponse,
    BootstrapResponse,
    LoginRequest,
    MeResponse,
    RegisterRequest,
)
from app.auth.security import create_token
from app.auth.service import login, register
from app.persistence.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/bootstrap", response_model=BootstrapResponse)
async def api_bootstrap(db: AsyncSession = Depends(get_db)) -> BootstrapResponse:
    """是否处于引导态（无任何用户）——前端据此决定邀请码字段显隐。"""
    from sqlalchemy import func

    count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    return BootstrapResponse(needs_invite=count > 0)


@router.post("/register", response_model=AuthResponse)
async def api_register(
    body: RegisterRequest, db: AsyncSession = Depends(get_db)
) -> AuthResponse:
    try:
        user = await register(db, body.username, body.password, body.invite_code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return AuthResponse(
        token=create_token(user.id, user.username), user_id=user.id, username=user.username
    )


@router.post("/login", response_model=AuthResponse)
async def api_login(
    body: LoginRequest, db: AsyncSession = Depends(get_db)
) -> AuthResponse:
    try:
        user = await login(db, body.username, body.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from None
    return AuthResponse(
        token=create_token(user.id, user.username), user_id=user.id, username=user.username
    )


@router.get("/me", response_model=MeResponse)
async def api_me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(user_id=user.id, username=user.username)
