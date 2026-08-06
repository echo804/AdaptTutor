#!/usr/bin/env bash
# AdaptTutor 备份脚本（服务器 cron 或手动执行）
# 备份内容：PostgreSQL 全量（pg_dump -Fc）+ 领域包目录（tar.gz）
# 用法：BACKUP_DIR=/app/backups PG_CONTAINER=adapttutor-prod-pg PACKS_DIR=/app/domain_packs ./backup.sh
set -euo pipefail

TS=$(date +%Y%m%d_%H%M%S)
BASE="${BACKUP_DIR:-/app/backups}"
PG_CONTAINER="${PG_CONTAINER:-adapttutor-prod-pg}"
PACKS_DIR="${PACKS_DIR:-/app/domain_packs}"
KEEP="${KEEP:-7}"
PG_USER="${PG_USER:-adapt}"
PG_DB="${PG_DB:-adapttutor}"

mkdir -p "$BASE"

echo "[backup] 导出 PG 数据（$PG_CONTAINER）…"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc -f /tmp/adapttutor.dump
docker cp "$PG_CONTAINER:/tmp/adapttutor.dump" "$BASE/adapttutor_pg_$TS.dump"
docker exec "$PG_CONTAINER" rm -f /tmp/adapttutor.dump

echo "[backup] 打包领域包（$PACKS_DIR）…"
tar -czf "$BASE/adapttutor_packs_$TS.tar.gz" -C "$(dirname "$PACKS_DIR")" "$(basename "$PACKS_DIR")"

# 保留最近 $KEEP 份
ls -1t "$BASE"/adapttutor_pg_*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$BASE"/adapttutor_packs_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[backup] 完成：$BASE/adapttutor_pg_$TS.dump + adapttutor_packs_$TS.tar.gz"
