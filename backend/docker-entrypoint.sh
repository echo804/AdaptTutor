#!/bin/sh
# 后端容器入口：首次启动把镜像内置领域包同步到持久卷（不覆盖已有自建包）。
# 之后每次启动：若卷里缺少某个内置包（如新版本新增），也一并补齐。
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

exec "$@"
