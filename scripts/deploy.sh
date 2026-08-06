#!/usr/bin/env bash
# AdaptTutor 一键部署脚本（Linux 服务器上执行）
# 用法：
#   git clone https://github.com/echo804/AdaptTutor.git && cd AdaptTutor
#   ./scripts/deploy.sh                 # 自动探测公网 IP
#   ./scripts/deploy.sh 123.45.67.89    # 或手动指定服务器 IP
#
# 流程：检查/安装 Docker → 生成生产密钥 → 取公网 IP → 填 NEXT_PUBLIC_API_BASE
#       → 构建并启动五服务 → 健康检查 → 打印访问地址。
# 无敏感信息（密钥写入 backend/.env.production，已被 .gitignore 忽略）。
set -euo pipefail

cd "$(dirname "$0")/.."   # 到仓库根

echo "=============================================="
echo " AdaptTutor 一键部署"
echo "=============================================="

# ---------- 1/6 Docker ----------
if ! command -v docker &>/dev/null; then
  echo "[1/6] 未检测到 Docker，开始安装（国内可改用阿里云镜像源）…"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  echo "[1/6] Docker 已安装: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || { echo "缺少 Docker Compose v2 插件，请先安装"; exit 1; }

# ---------- 2/6 生产密钥 ----------
echo "[2/6] 生成生产密钥（backend/.env.production）…"
if command -v python3 &>/dev/null; then
  python3 backend/scripts/gen_prod_secrets.py
else
  echo "未找到 python3，请手动安装后重试"; exit 1
fi

# ---------- 3/6 公网 IP ----------
IP="${1:-}"
if [ -z "$IP" ]; then
  echo "[3/6] 自动探测公网 IP…"
  IP=$(curl -4 -s --max-time 8 ifconfig.me || curl -4 -s --max-time 8 ip.sb || true)
fi
if [ -z "$IP" ]; then
  echo "无法自动获取公网 IP，请手动指定: ./scripts/deploy.sh <服务器IP>"
  exit 1
fi
export NEXT_PUBLIC_API_BASE="http://$IP:8010"
echo "      公网 IP: $IP  →  前端 API 指向 $NEXT_PUBLIC_API_BASE"

# ---------- 4/6 配置提示 ----------
# 生产 CORS：放行前端来源 http://IP:3000（覆盖模板空值行，已有真实 IP 则跳过）
ENVF=backend/.env.production
if grep -q '^CORS_ORIGINS_EXTRA=http' "$ENVF"; then
  echo "[4/6] CORS 白名单已存在: $(grep '^CORS_ORIGINS_EXTRA=' "$ENVF")"
else
  sed -i '/^CORS_ORIGINS_EXTRA=/d' "$ENVF"
  echo "CORS_ORIGINS_EXTRA=http://$IP:3000" >> "$ENVF"
  echo "[4/6] 已配置 CORS 白名单: http://$IP:3000"
fi
echo "      （如需改 PG 密码 / LLM key 编辑 backend/.env.production 后重跑）"

# ---------- 5/6 构建启动 ----------
echo "[5/6] 构建并启动五服务（首次约 5-10 分钟，取决于网络）…"
docker compose -f docker-compose.prod.yml up -d --build

# ---------- 6/6 健康检查 ----------
echo "[6/6] 等待服务就绪…"
for i in $(seq 1 40); do
  if curl -sf "http://localhost:8010/healthz" >/dev/null 2>&1; then
    echo "      ✅ 后端健康检查通过（db up）"
    break
  fi
  [ "$i" = "40" ] && { echo "      ⚠️ 后端 120 秒未就绪，请 docker compose logs api 排查"; }
  sleep 3
done

cat <<EOF

🎉 AdaptTutor 部署完成！

  前端        http://$IP:3000
  后端健康    http://$IP:8010/healthz
  监控-心跳   http://$IP:3001        （Uptime Kuma，首次建账号+加探活）
  监控-容器   https://$IP:9443       （Portainer，自签证书点继续）

  数据持久化：PG 卷 / 领域包卷 / 备份卷（容器重建不丢）
  每日备份：  crontab 加  30 2 * * * cd $(pwd) && ./scripts/backup.sh
  更新部署：  git pull && ./scripts/deploy.sh
EOF
