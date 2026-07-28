#!/usr/bin/env bash
set -euo pipefail

# Smoke test for MCP runtime. Run inside the container or via:
# docker compose exec mcp /config/scripts/smoke-test.sh

ROOT_DIR=$(dirname "$(readlink -f "$0")")/..

echo "[smoke] running preflight"
"${ROOT_DIR}/scripts/preflight.sh"

echo "[smoke] validating python CLI availability"
if python -m mcp_filesystem_sshfs --help >/dev/null 2>&1; then
  echo "[smoke] mcp_filesystem_sshfs CLI: OK"
else
  echo "[smoke] WARNING: mcp_filesystem_sshfs CLI did not return help output"
fi

if python -m mcp_filesystem_sshfs.chat_history --help >/dev/null 2>&1; then
  echo "[smoke] chat_history CLI: OK"
else
  echo "[smoke] WARNING: chat_history CLI did not return help output"
fi

echo "[smoke] optional aggregator test"
if [ -n "${MCP_AGGREGATOR_URL:-}" ]; then
  echo "[smoke] calling aggregator at ${MCP_AGGREGATOR_URL}"
  if command -v curl >/dev/null 2>&1; then
    set +e
    http_status=$(curl -s -o /dev/null -w "%{http_code}" "${MCP_AGGREGATOR_URL}/health" || true)
    set -e
    echo "[smoke] aggregator /health returned: ${http_status}"
  else
    echo "[smoke] curl not available; skipping aggregator call"
  fi
else
  echo "[smoke] MCP_AGGREGATOR_URL not set; skipping aggregator call"
fi

echo "[smoke] done"

exit 0
