"""FastAPI 入口。

M1a 阶段：应用骨架 + 健康检查端点。
M1b 起逐步挂载 auth/keys/engine/domain/api 路由。
"""

from fastapi import FastAPI

from app.config import Settings, get_settings

app = FastAPI(
    title="AdaptTutor API",
    version="0.1.0",
    description="自适应学习引擎后端",
)


@app.get("/healthz")
async def healthz() -> dict:
    """健康检查（M1a：基础存活；M1b 起补 PG 连通 + 领域包加载状态）。"""
    return {
        "ok": True,
        "app": "adapttutor-backend",
        "version": "0.1.0",
        "settings": get_settings().log_level,
    }
