#!/usr/bin/env bash
set -euo pipefail
SOPS_BIN=${SOPS_BIN:-/usr/local/bin/sops}
export SOPS_AGE_KEY_FILE=${SOPS_AGE_KEY_FILE:-/root/.config/sops/age/keys.txt}
SRC="${1:-/mcp-srv/secrets/.env}"
DST="${2:-/opt/1mcp/.env}"

"$SOPS_BIN" --decrypt "$SRC" > "$DST"
chown root:root "$DST"
chmod 600 "$DST"
docker restart 1mcp
