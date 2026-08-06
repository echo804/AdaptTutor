#!/usr/bin/env bash
# 生成邀请码（服务器上执行，7 天有效、一次性）
# 用法：./scripts/make_invite.sh DEMO2026
set -euo pipefail
CODE="${1:?用法: ./scripts/make_invite.sh <邀请码>}"
PG="${PG_CONTAINER:-adapttutor-prod-pg}"
docker exec "$PG" psql -U adapt -d adapttutor -c \
  "INSERT INTO invite_codes (code, created_at, expires_at) VALUES ('$CODE', now(), now() + interval '7 days');"
echo "邀请码 $CODE 已创建（7 天内有效，一次性）"
