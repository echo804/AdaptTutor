"""M4r8 迁移：mastery_states / learning_events 加 pack_id 列（多领域进度隔离）。

- mastery_states：加 pack_id（存量填 junior_math_eq_ineq）+ 唯一约束改 (student_id, pack_id, node_id)
- learning_events：加 pack_id（可空，存量填默认）
幂等：重复执行安全。
"""

import asyncio

from sqlalchemy import text

from app.persistence.db import get_session_factory

SQL = [
    # mastery_states：加列（NOT NULL + DEFAULT 让存量行自动填默认包）
    "ALTER TABLE mastery_states ADD COLUMN IF NOT EXISTS pack_id VARCHAR(64) NOT NULL DEFAULT 'junior_math_eq_ineq'",
    # 旧唯一约束 → 新 (student_id, pack_id, node_id)
    "ALTER TABLE mastery_states DROP CONSTRAINT IF EXISTS uq_mastery_states_student_node",
    "ALTER TABLE mastery_states ADD CONSTRAINT uq_mastery_states_student_pack_node UNIQUE (student_id, pack_id, node_id)",
    # learning_events：加列（存量填默认包）
    "ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS pack_id VARCHAR(64) DEFAULT 'junior_math_eq_ineq'",
]


async def main() -> None:
    async with get_session_factory()() as db:
        for q in SQL:
            await db.execute(text(q))
        await db.commit()
    print("迁移完成：pack_id 列 + 唯一约束已就绪")


if __name__ == "__main__":
    asyncio.run(main())
