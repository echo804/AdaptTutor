"""回溯补 learning_events.answer 事件（M4r21h 埋点前的历史作答）。

背景：修复前判题只写 wrong_answer 事件，没有 answer 事件，
导致学习趋势接口（统计 event_type='answer'）对历史数据为空。

本脚本：为每个历史 wrong_answer 补一条对应的 answer 事件
（correct=false，user_answer 从 payload 取）。幂等：仅当该
session+qid 尚无 answer 事件时补。

用法（backend 目录）：
  .venv\\Scripts\\python.exe scripts/backfill_answer_events.py [--dry-run]
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.persistence.db import get_session_factory  # noqa: E402
from app.persistence.models import LearningEvent  # noqa: E402


async def backfill(dry_run: bool = True) -> int:
    factory = get_session_factory()
    count = 0
    async with factory() as db:
        # 所有 wrong_answer 事件
        res = await db.execute(
            select(LearningEvent).where(LearningEvent.event_type == "wrong_answer")
        )
        wrongs = res.scalars().all()
        # 已存在的 answer 事件（用于幂等）
        ans_res = await db.execute(
            select(LearningEvent).where(LearningEvent.event_type == "answer")
        )
        existing = {
            (a.session_id, (a.payload or {}).get("qid") if a.payload else None)
            for a in ans_res.scalars().all()
        }
        for w in wrongs:
            qid = (w.payload or {}).get("qid") if w.payload else None
            if (w.session_id, qid) in existing:
                continue
            ans = LearningEvent(
                student_id=w.student_id,
                session_id=w.session_id,
                event_type="answer",
                node_id=w.node_id,
                pack_id=w.pack_id,
                payload={
                    "qid": qid,
                    "correct": False,
                    "user_answer": (w.payload or {}).get("user_answer") if w.payload else None,
                    "backfilled": True,
                },
                ts=w.ts,
            )
            if not dry_run:
                db.add(ans)
                count += 1
        if not dry_run:
            await db.commit()
    return count


async def main() -> int:
    dry = "--dry-run" in sys.argv
    n = await backfill(dry_run=dry)
    print(f"[{'dry-run' if dry else '执行'}] 将补 {n} 条 answer 事件")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
