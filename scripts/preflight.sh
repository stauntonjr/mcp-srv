#!/usr/bin/env bash
set -euo pipefail

# Minimal preflight checks for the mcp container environment.
# Intended to be run inside the `mcp` container (or with docker compose exec mcp).

KEY_PATH=${FS_MSI_KEY_PATH:-/ssh/id_ed25519}
MCP_CONFIG=${MCP_CONFIG_PATH:-/config/mcp.json}

echo "[preflight] checking key path: ${KEY_PATH}"
if [ -f "${KEY_PATH}" ]; then
  echo "[preflight] key: OK (${KEY_PATH})"
else
  echo "[preflight] ERROR: key not found at ${KEY_PATH}" >&2
  exit 2
fi

echo "[preflight] checking mcp config: ${MCP_CONFIG}"
if command -v jq >/dev/null 2>&1; then
  if [ -f "${MCP_CONFIG}" ]; then
    if jq empty "${MCP_CONFIG}" >/dev/null 2>&1; then
      echo "[preflight] mcp.json: OK"
    else
      echo "[preflight] ERROR: ${MCP_CONFIG} is not valid JSON" >&2
      exit 3
    fi
  else
    echo "[preflight] ERROR: mcp config not found at ${MCP_CONFIG}" >&2
    exit 4
  fi
else
  echo "[preflight] WARNING: jq not installed; skipping JSON parse check"
fi

echo "[preflight] checking sqlite3 availability"
if command -v sqlite3 >/dev/null 2>&1; then
  echo "[preflight] sqlite3: $(sqlite3 --version)"
else
  echo "[preflight] WARNING: sqlite3 not found in PATH"
fi

echo "[preflight] checking python imports (mcp files)"
if command -v python >/dev/null 2>&1; then
  if python - <<'PY' 2>/dev/null
try:
    import importlib
    importlib.import_module('mcp_filesystem_sshfs')
    importlib.import_module('mcp_filesystem_sshfs.chat_history')
    print('OK')
except Exception as e:
    raise
PY
  then
    echo "[preflight] python modules: OK"
  else
    echo "[preflight] WARNING: unable to import python mcp modules (see python output)"
  fi
else
  echo "[preflight] WARNING: python not available in PATH"
fi

echo "[preflight] done"

exit 0
