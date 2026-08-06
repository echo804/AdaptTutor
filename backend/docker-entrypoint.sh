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
# 兜底：补齐 alembic 未覆盖的表（create_all，幂等）与列（模型 metadata 对比，幂等 ALTER）
echo "[entrypoint] 同步模型表/列（幂等）…"
python -c "
import asyncio
from sqlalchemy import inspect, text
from app.persistence.models import Base
from app.persistence.db import get_engine

async def _sync():
    async with get_engine().begin() as conn:
        def _do(sync_conn):
            insp = inspect(sync_conn)
            tables = set(insp.get_table_names())
            for table in Base.metadata.sorted_tables:
                if table.name not in tables:
                    table.create(bind=sync_conn, checkfirst=True)
                    print(f'[sync] 建表 {table.name}')
                    continue
                cols = {c['name'] for c in insp.get_columns(table.name)}
                for c in table.columns:
                    if c.name in cols:
                        continue
                    col_type = c.type.compile(dialect=sync_conn.dialect)
                    nullable = '' if c.nullable else ' NOT NULL'
                    default = ''
                    if c.default is not None and c.default.is_scalar:
                        arg = c.default.arg
                        default = f' DEFAULT {arg!r}' if isinstance(arg, str) else f' DEFAULT {arg}'
                    sync_conn.execute(text(
                        f'ALTER TABLE {table.name} ADD COLUMN IF NOT EXISTS {c.name} {col_type}{default}{nullable}'
                    ))
                    print(f'[sync] 补列 {table.name}.{c.name}')
        await conn.run_sync(_do)

asyncio.run(_sync())
"

exec "$@"
