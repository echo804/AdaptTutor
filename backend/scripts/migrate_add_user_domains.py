"""M4r8d 迁移：user_domains + generation_tasks 表（用户自建领域）。

幂等：CREATE TABLE IF NOT EXISTS，重复执行安全。
"""

import asyncio

from sqlalchemy import text

from app.persistence.db import get_session_factory

SQL = [
    """
    CREATE TABLE IF NOT EXISTS user_domains (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pack_id VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT,
        visibility VARCHAR(16) NOT NULL DEFAULT 'private',
        status VARCHAR(16) NOT NULL DEFAULT 'draft',
        reject_reason VARCHAR(300),
        nodes_count INTEGER,
        questions_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_user_domains_user_id ON user_domains(user_id)",
    """
    CREATE TABLE IF NOT EXISTS generation_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain_id INTEGER REFERENCES user_domains(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'running',
        progress INTEGER NOT NULL DEFAULT 0,
        stage VARCHAR(64),
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_generation_tasks_user_id ON generation_tasks(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_generation_tasks_domain_id ON generation_tasks(domain_id)",
]


async def main() -> None:
    async with get_session_factory()() as db:
        for q in SQL:
            await db.execute(text(q))
        await db.commit()
    print("迁移完成：user_domains + generation_tasks 已就绪")


if __name__ == "__main__":
    asyncio.run(main())
