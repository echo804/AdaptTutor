"""清理测试数据（保留真实用户）。

用法（backend 目录）：
  .venv\\Scripts\\python.exe scripts/cleanup_test_data.py [--dry-run]

删除 pytest 集成测试产生的 u_* 前缀测试账号及其全部关联数据；
真实用户（如首用户）不受影响。--dry-run 只列出不删除。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select  # noqa: E402

from app.persistence.db import get_session_factory  # noqa: E402
from app.persistence.models import (  # noqa: E402
    Evaluation,
    InviteCode,
    LearningEvent,
    MasteryState,
    Message,
    Session,
    User,
    UserApiKey,
)


async def cleanup(dry_run: bool = False) -> int:
    factory = get_session_factory()
    async with factory() as db:
        rows = (await db.execute(select(User.id, User.username))).all()
        test_ids = [uid for uid, uname in rows if uname.startswith("u_")]
        if dry_run or not test_ids:
            for _, uname in rows:
                if uname.startswith("u_"):
                    print(f"[dry-run] 将删除测试账号: {uname}")
            return len(test_ids)
        sub = select(Session.id).where(Session.student_id.in_(test_ids))
        await db.execute(delete(Message).where(Message.session_id.in_(sub)))
        await db.execute(delete(Evaluation).where(Evaluation.session_id.in_(sub)))
        await db.execute(delete(Session).where(Session.student_id.in_(test_ids)))
        await db.execute(delete(LearningEvent).where(LearningEvent.student_id.in_(test_ids)))
        await db.execute(delete(MasteryState).where(MasteryState.student_id.in_(test_ids)))
        await db.execute(delete(UserApiKey).where(UserApiKey.user_id.in_(test_ids)))
        await db.execute(delete(InviteCode).where(InviteCode.used_by.in_(test_ids)))
        await db.execute(delete(User).where(User.id.in_(test_ids)))
        await db.commit()
        print(f"已删除 {len(test_ids)} 个测试账号")
        return len(test_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description="清理测试账号（保留真实用户）")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(cleanup(dry_run=args.dry_run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
