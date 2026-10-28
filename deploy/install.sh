#!/usr/bin/env bash
# 在服务器仓库目录执行。默认用 Docker，只把 127.0.0.1:8787 交给现有反向代理。
# 不想用 Docker：sudo ./deploy/install.sh --systemd
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODE="docker"
if [[ "${1:-}" == "--systemd" ]]; then
  MODE="systemd"
elif [[ -n "${1:-}" ]]; then
  echo "用法: ./deploy/install.sh [--systemd]" >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  chmod 600 "$ROOT/.env"
  echo "已创建 .env。端口默认 8787，只监听本机。"
fi

mkdir -p "$ROOT/data" "$ROOT/backups"
chmod 700 "$ROOT/data" "$ROOT/backups"

install_cron() {
  local user="$1"
  local node_dir="$2"
  local file="/etc/cron.d/couple-app"
  cat > "$file" <<EOF
# couple-app-backup
SHELL=/bin/bash
PATH=$node_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 4 * * * $user cd $ROOT && flock -n $ROOT/backups/.lock $ROOT/deploy/backup.sh >> $ROOT/backups/backup.log 2>&1
EOF
  chmod 644 "$file"
  echo "已写入每天 04:15 的备份任务：$file"
}

if [[ "$MODE" == "docker" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "没有找到 docker。可以改用：sudo ./deploy/install.sh --systemd" >&2
    exit 1
  fi
  docker compose up -d --build
  echo "应用已启动，只监听 127.0.0.1:${HOST_PORT:-8787}。"
  echo "请用现有的 Caddy 或 Nginx 反代到这个地址，不要把 8787 暴露到公网。"
  echo "确认 80 和 443 空闲后，才可以：docker compose --profile caddy up -d"
  if [[ "$(id -u)" -eq 0 ]]; then
    install_cron root "$(dirname "$(command -v node || echo /usr/bin/node)")"
  else
    echo "当前不是 root，未写入定时备份。可用 sudo 再执行一次，或手动把 deploy/backup.sh 加入 cron。"
  fi
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "systemd 安装需要 root：sudo ./deploy/install.sh --systemd" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "需要先安装 Node.js 22。" >&2
  exit 1
fi
major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "$major" -lt 22 ]]; then
  echo "需要 Node.js 22 或更新版本，当前是 $(node -v)。" >&2
  exit 1
fi

if ! id couple >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/couple --shell /usr/sbin/nologin couple
fi
npm ci --omit=dev
chown -R couple:couple "$ROOT/data" "$ROOT/backups"
NODE_BIN="$(command -v node)"
sed -e "s|@ROOT@|$ROOT|g" -e "s|@NODE@|$NODE_BIN|g" "$ROOT/deploy/couple.service" > /etc/systemd/system/couple-app.service
systemctl daemon-reload
systemctl enable --now couple-app
install_cron couple "$(dirname "$NODE_BIN")"
echo "systemd 服务 couple-app 已启动。监听地址见 .env，默认 127.0.0.1:8787。"
