"""邀请码生成 CLI（对齐 03 6 scripts/gen_invite.py / 04：CLI 生成、一次性、过期失效）。

用法（backend 目录）：
  .venv\\Scripts\\python.exe scripts/gen_invite.py [--count 1] [--days 7]
输出新邀请码（每行一个）。
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.persistence.db import get_session_factory  # noqa: E402
from app.persistence.models import InviteCode  # noqa: E402


async def generate(count: int, days: int) -> list[str]:
    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    codes: list[str] = []
    async with factory() as db:
        for _ in range(count):
            code = secrets.token_urlsafe(8)
            db.add(
                InviteCode(code=code, created_at=now, expires_at=now + timedelta(days=days))
            )
            codes.append(code)
        await db.commit()
    return codes


def main() -> int:
    parser = argparse.ArgumentParser(description="生成一次性邀请码")
    parser.add_argument("--count", type=int, default=1, help="生成数量")
    parser.add_argument("--days", type=int, default=7, help="有效期（天）")
    args = parser.parse_args()
    codes = asyncio.run(generate(args.count, args.days))
    for c in codes:
        print(c)
    return 0


if __name__ == "__main__":
    sys.exit(main())
