"""FastAPI 入口（M4：挂载 auth/keys/sessions/students 路由 + CORS + 健康检查）。"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import routes_auth, routes_domains, routes_feedback, routes_invites, routes_keys, routes_sessions, routes_students, routes_user_domains
from app.config import Settings, get_settings
from app.persistence.db import get_engine

app = FastAPI(
    title="AdaptTutor API",
    version="0.4.0",
    description="自适应学习引擎后端",
)

# CORS：本地开发源 + 生产额外放行（CORS_ORIGINS_EXTRA 逗号分隔，见 .env.production）
_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
]
_extra = get_settings().cors_origins_extra
if _extra:
    _cors_origins += [o.strip() for o in _extra.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_auth.router)
app.include_router(routes_invites.router)
app.include_router(routes_keys.router)
app.include_router(routes_domains.router)
app.include_router(routes_feedback.router)
app.include_router(routes_sessions.router)
app.include_router(routes_students.router)
app.include_router(routes_user_domains.router)


@app.get("/healthz")
async def healthz() -> dict:
    """健康检查：应用存活 + PG 连通（M4：供 compose healthcheck / 前端探活）。"""
    db_ok = True
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    settings: Settings = get_settings()
    return {
        "ok": db_ok,
        "app": "adapttutor-backend",
        "version": "0.4.0",
        "db": "up" if db_ok else "down",
        "settings": settings.log_level,
    }
