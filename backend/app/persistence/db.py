"""PG 连接与会话管理（async SQLAlchemy + asyncpg）。

对齐 docs/00-环境搭建.md 4.2（DATABASE_URL=postgresql+asyncpg://...）。
架构纪律：引擎模块不 import 本模块（依赖反转）；repository 层与 API 层使用。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings
from app.persistence.models import Base  # noqa: F401  # 确保模型注册到 metadata

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            echo=False,
            pool_pre_ping=True,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(), expire_on_commit=False
        )
    return _session_factory


async def dispose() -> None:
    """释放连接池（测试/关闭用）。"""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
