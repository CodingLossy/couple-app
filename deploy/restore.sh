#!/usr/bin/env bash
# 从备份恢复。会先停应用，并把当前 data 改名为 data-before-restore-*。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -ne 1 ]]; then
  echo "用法: ./deploy/restore.sh <备份.zip>" >&2
  exit 1
fi

ZIP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [[ ! -f "$ZIP" ]]; then
  echo "找不到备份文件：$ZIP" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
USING_DOCKER=0
USING_SYSTEMD=0

if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  USING_DOCKER=1
  docker compose stop app
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet couple-app; then
  USING_SYSTEMD=1
  sudo systemctl stop couple-app
fi

if [[ -d "$ROOT/data" ]]; then
  mv "$ROOT/data" "$ROOT/data-before-restore-$STAMP"
fi
mkdir -p "$ROOT/data"
chmod 700 "$ROOT/data"

cleanup_failed() {
  echo "恢复失败。当前数据仍在 data-before-restore-$STAMP（如果刚才存在）。" >&2
}
trap cleanup_failed ERR

if [[ "$USING_DOCKER" -eq 1 ]]; then
  mkdir -p "$ROOT/backups"
  cp "$ZIP" "$ROOT/backups/.restore-$STAMP.zip"
  chmod 600 "$ROOT/backups/.restore-$STAMP.zip"
  docker compose run --rm --no-deps app node scripts/restore-backup.js "/backups/.restore-$STAMP.zip"
  rm -f "$ROOT/backups/.restore-$STAMP.zip"
elif [[ -d "$ROOT/node_modules/better-sqlite3" ]]; then
  node "$ROOT/scripts/restore-backup.js" "$ZIP"
else
  echo "没有 Node 依赖，也不是 Docker 部署，无法恢复。" >&2
  exit 1
fi

trap - ERR
echo "已恢复。上一份数据在 data-before-restore-$STAMP，确认无误后可以删掉。"

if [[ "$USING_DOCKER" -eq 1 ]]; then
  docker compose start app
elif [[ "$USING_SYSTEMD" -eq 1 ]]; then
  sudo systemctl start couple-app
else
  echo "请重新启动应用。"
fi
