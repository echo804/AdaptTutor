#!/bin/sh
# 后端容器入口：
#   1) 首次启动把镜像内置领域包同步到持久卷（不覆盖已有自建包）
#   2) 启动前执行数据库迁移（alembic upgrade head，幂等——全新库建表，存量库增量）
#   3) 交给 CMD 启动 uvicorn
set -e

BUILTIN=/app/domain_packs_builtin
TARGET=/app/domain_packs

if [ -d "$BUILTIN" ]; then
  mkdir -p "$TARGET"
  for d in "$BUILTIN"/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    if [ ! -d "$TARGET/$name" ]; then
      cp -r "$d" "$TARGET/$name"
      echo "[entrypoint] 同步内置领域包: $name"
    fi
  done
fi

echo "[entrypoint] 执行数据库迁移…"
alembic upgrade head
# 兜底：补齐 alembic 未覆盖的模型表（如 user_domains/review_schedule 等后加表，幂等 create_all）
echo "[entrypoint] 补齐缺失表（模型 create_all，幂等）…"
python -c "
import asyncio
from app.persistence.models import Base
from app.persistence.db import get_engine

async def _create_all():
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

asyncio.run(_create_all())
"

exec "$@"
