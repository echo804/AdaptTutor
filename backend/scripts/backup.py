"""每日备份脚本（对齐 docs/04 备份决策：D:\\AdaptTutorBackup，保留 N 份）。

用法（backend 目录）：
  .venv\\Scripts\\python.exe scripts/backup.py [--keep 7] [--dir D:\\AdaptTutorBackup] [--dry-run]

通过 docker exec 调 pg_dump（PG 容器），gzip 压缩后写入备份目录，保留最近 N 份。
"""

from __future__ import annotations

import argparse
import gzip
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_DIR = "D:\\AdaptTutorBackup"
DEFAULT_CONTAINER = "adapttutor-postgres"
DEFAULT_USER = "adapt"
DEFAULT_DB = "adapttutor"


def backup(
    backup_dir: str = DEFAULT_DIR,
    keep: int = 7,
    container: str = DEFAULT_CONTAINER,
    db_user: str = DEFAULT_USER,
    db_name: str = DEFAULT_DB,
    dry_run: bool = False,
) -> Path | None:
    d = Path(backup_dir)
    d.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    gz = d / f"adapttutor_{ts}.sql.gz"

    if dry_run:
        print(f"[dry-run] 将执行: docker exec {container} pg_dump -U {db_user} {db_name} -> {gz}")
    else:
        raw = d / f"adapttutor_{ts}.sql"
        subprocess.run(
            ["docker", "exec", container, "pg_dump", "-U", db_user, db_name],
            stdout=raw.open("wb"),
            check=True,
        )
        with raw.open("rb") as f, gzip.open(gz, "wb") as g:
            shutil.copyfileobj(f, g)
        raw.unlink()
        print(f"备份完成: {gz}")

    # 保留最近 N 份
    backups = sorted(d.glob("adapttutor_*.sql.gz"))
    stale = backups[:-keep] if keep > 0 else backups
    for old in stale:
        if dry_run:
            print(f"[dry-run] 将删除过期备份: {old.name}")
        else:
            old.unlink()
            print(f"删除过期备份: {old.name}")

    print(f"当前保留 {min(len(backups), keep)} 份（目录 {d}）")
    return gz if not dry_run else None


def main() -> None:
    parser = argparse.ArgumentParser(description="AdaptTutor 每日备份")
    parser.add_argument("--keep", type=int, default=7, help="保留备份份数")
    parser.add_argument("--dir", default=DEFAULT_DIR, help="备份目录")
    parser.add_argument("--dry-run", action="store_true", help="只打印不执行")
    args = parser.parse_args()
    backup(backup_dir=args.dir, keep=args.keep, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main() or 0)
