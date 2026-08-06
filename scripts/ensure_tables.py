# -*- coding: utf-8 -*-
"""幂等补建缺失表（无 alembic 迁移流时的建表入口）。"""
import asyncio
import sys

sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import text

from app.persistence.db import get_engine
from app.persistence.models import Base  # noqa: F401  # 注册全部模型


async def main() -> None:
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_engine().begin() as conn:
        rows = (
            await conn.execute(
                text(
                    "select tablename from pg_tables "
                    "where schemaname='public' and tablename='review_schedule'"
                )
            )
        ).all()
        print("review_schedule 表存在:", bool(rows))


asyncio.run(main())
