#!/bin/sh
set -eu
umask 077
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/photos" "$DATA_DIR/thumbs" "$DATA_DIR/tmp" /backups
chown -R app:app "$DATA_DIR" /backups
cd /app
if [ "$#" -gt 0 ]; then
  exec runuser --user app -- "$@"
fi
exec runuser --user app -- node server/index.js
