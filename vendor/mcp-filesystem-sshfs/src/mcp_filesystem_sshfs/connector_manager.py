"""Connector manager for multi-backend SSHFS MCP.

Loads a JSON connector configuration and provides access to per-store
SSHConnectionManager and PathValidator instances.
"""

import json
import logging
import os
from pathlib import Path
import re
from typing import Dict

from .ssh_manager import SSHConnectionManager
from .path_validator import PathValidator


class ConnectorConfigError(Exception):
    pass


_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
_LOG = logging.getLogger(__name__)


def _expand_environment(value):
    """Expand ${VAR} recursively and return unresolved variable names."""
    unresolved = set()
    if isinstance(value, str):
        def replace(match):
            name = match.group(1)
            replacement = os.environ.get(name)
            if replacement is None:
                unresolved.add(name)
                return match.group(0)
            return replacement
        return _ENV_REF.sub(replace, value), unresolved
    if isinstance(value, list):
        expanded = []
        for item in value:
            resolved, missing = _expand_environment(item)
            expanded.append(resolved)
            unresolved.update(missing)
        return expanded, unresolved
    if isinstance(value, dict):
        expanded = {}
        for key, item in value.items():
            resolved, missing = _expand_environment(item)
            expanded[key] = resolved
            unresolved.update(missing)
        return expanded, unresolved
    return value, unresolved


def _normalise_allowed_dirs(store: dict) -> None:
    """Allow a comma-separated environment variable to supply multiple paths."""
    normalised = []
    for allowed_dir in store.get("allowed_dirs", []):
        if not isinstance(allowed_dir, str):
            raise ConnectorConfigError(f"Store {store.get(id)} has a non-string allowed directory")
        normalised.extend(part.strip() for part in allowed_dir.split(",") if part.strip())
    store["allowed_dirs"] = normalised


class ConnectorManager:
    def __init__(self, config_path: str):
        self.config_path = Path(config_path)
        if not self.config_path.exists():
            raise ConnectorConfigError(f"Connector config not found: {self.config_path}")

        raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        self._stores: Dict[str, dict] = {}
        for configured_store in raw.get("stores") or []:
            store, missing = _expand_environment(configured_store)
            store_id = store.get("id", "<unknown>")
            if missing:
                _LOG.warning("Skipping store %s; missing environment variables: %s", store_id, ", ".join(sorted(missing)))
                continue
            _normalise_allowed_dirs(store)
            self._stores[store_id] = store

        self._managers: Dict[str, SSHConnectionManager] = {}
        self._validators: Dict[str, PathValidator] = {}

    def list_stores(self):
        return [{"id": sid, "label": s.get("label"), "host": s.get("host"), "allowed_dirs": s.get("allowed_dirs", [])} for sid, s in self._stores.items()]

    def get_store_config(self, store_id: str) -> dict:
        if store_id not in self._stores:
            raise KeyError(store_id)
        return self._stores[store_id]

    def get_manager(self, store_id: str) -> SSHConnectionManager:
        if store_id not in self._managers:
            cfg = self.get_store_config(store_id)
            self._managers[store_id] = SSHConnectionManager(host=cfg["host"], username=cfg["username"], port=cfg.get("port", 22), key_path=cfg.get("key_path"))
        return self._managers[store_id]

    def get_validator(self, store_id: str) -> PathValidator:
        if store_id not in self._validators:
            self._validators[store_id] = PathValidator(self.get_store_config(store_id).get("allowed_dirs", []))
        return self._validators[store_id]
