#!/usr/bin/env bash
# 把用户设为管理员（服务器上执行）
# 用法：./scripts/make_admin.sh <用户名>
set -euo pipefail
USERNAME="${1:?用法: ./scripts/make_admin.sh <用户名>}"
PG="${PG_CONTAINER:-adapttutor-prod-pg}"
docker exec "$PG" psql -U adapt -d adapttutor -c \
  "UPDATE users SET meta = jsonb_set(COALESCE(meta, '{}'), '{is_admin}', 'true') WHERE username = '$USERNAME';"
echo "已将 $USERNAME 设为管理员（刷新页面生效）"
