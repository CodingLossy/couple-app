#!/usr/bin/env bash
# 备份数据库、推送密钥和照片。备份包权限是 0600，保留 14 天。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/backups"

if [[ -x "$ROOT/node_modules/.bin/node" || -d "$ROOT/node_modules/better-sqlite3" ]]; then
  exec node "$ROOT/scripts/make-backup.js" "$ROOT/backups"
fi

if command -v docker >/dev/null 2>&1 && docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  exec docker compose exec -T -u app app node scripts/make-backup.js /backups
fi

echo "没有找到本机依赖，应用容器也没在运行，无法备份。" >&2
exit 1
