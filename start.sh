#!/usr/bin/env bash
# 本地一条命令启动。只监听 127.0.0.1:8787。
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 22 或更新版本。" >&2
  exit 1
fi
major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "$major" -lt 22 ]]; then
  echo "需要 Node.js 22 或更新版本，当前是 $(node -v)。" >&2
  exit 1
fi
if [[ ! -d node_modules/better-sqlite3 ]]; then
  npm install
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已根据 .env.example 创建 .env。"
fi
umask 077
exec node server/index.js
