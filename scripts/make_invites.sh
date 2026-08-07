#!/usr/bin/env bash
# 批量生成邀请码（服务器上执行）
# 用法：./scripts/make_invites.sh <数量> [前缀]
# 示例：./scripts/make_invites.sh 20 GUEST   → 生成 GUEST01..GUEST20
set -euo pipefail
COUNT="${1:?用法: ./scripts/make_invites.sh <数量> [前缀]}"
PREFIX="${2:-INV}"
PG="${PG_CONTAINER:-adapttutor-prod-pg}"
[[ "$COUNT" =~ ^[0-9]+$ ]] || { echo "数量需为数字"; exit 1; }

codes=()
for i in $(seq 1 "$COUNT"); do
  code=$(printf '%s%02d' "$PREFIX" "$i")
  codes+=("$code")
done
SQL="INSERT INTO invite_codes (code, created_at, expires_at) VALUES "
SQL+="$(printf "('%s', now(), now() + interval '7 days')," "${codes[@]}" | sed 's/,$//')"
SQL+=" ON CONFLICT (code) DO NOTHING;"

docker exec "$PG" psql -U adapt -d adapttutor -c "$SQL" >/dev/null
echo "已生成 $COUNT 个邀请码（7 天有效，一次性，冲突自动跳过）："
printf '  %s\n' "${codes[@]}"
