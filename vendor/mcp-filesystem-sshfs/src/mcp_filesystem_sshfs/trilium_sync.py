"""Shared Trilium sync utilities for MCP filesystem SSHFS tools.

This module centralizes logic used by both the MCP multi-backend tool and
standalone scripts so that importing chat transcripts to Trilium can rely on
one tested implementation.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# ---------------------------------------------------------------------------
# Markdown metadata helpers
# ---------------------------------------------------------------------------

def parse_front_matter(markdown: str) -> Dict[str, str]:
    """Parse a minimal front-matter block fenced as ```yaml.

    Returns a dict of key/value pairs. Nested values are not supported, which
    matches the structure produced by the SpecStory exporter.
    """
    if not markdown:
        return {}

    match = re.search(r"```yaml\n(.*?)\n```", markdown, flags=re.S)
    if not match:
        return {}

    metadata: Dict[str, str] = {}
    body = match.group(1)
    for line in body.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata


def detect_title(markdown: str, metadata: Dict[str, str], fallback: str) -> str:
    """Determine a note title using metadata, headings, or a fallback."""
    title_from_meta = metadata.get("title")
    if title_from_meta:
        generic_fallbacks = {"VS Code Chat Export"}
        stripped = title_from_meta.strip()
        if stripped and stripped not in generic_fallbacks:
            return stripped

    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()

    return fallback


# ---------------------------------------------------------------------------
# Trilium client + importer
# ---------------------------------------------------------------------------

@dataclass
class MarkdownSession:
    """Represents a markdown transcript to be imported into Trilium."""

    source_path: str
    content: str
    session_id: str
    title: str
    host: str
    workspace: str
    filename: Optional[str] = None
    mtime: Optional[float] = None
    metadata: Dict[str, str] = field(default_factory=dict)

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content.encode("utf-8")).hexdigest()


class TriliumRequestError(RuntimeError):
    pass


class TriliumClient:
    """Very small HTTP client for the Trilium ETAPI."""

    def __init__(self, base_url: str, token: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _request(self, method: str, path: str, payload: Optional[dict] = None) -> dict:
        url = f"{self.base_url}/{path.lstrip('/')}"
        headers = {"Authorization": self.token}
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8")
        except HTTPError as exc:  # pragma: no cover - network error paths
            detail = exc.read().decode("utf-8", errors="ignore") if exc.fp else str(exc)
            raise TriliumRequestError(f"Trilium request failed ({exc.code}): {detail}") from exc
        except URLError as exc:  # pragma: no cover - network error paths
            raise TriliumRequestError(f"Unable to reach Trilium at {url}: {exc}") from exc

        if not body:
            return {}

        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise TriliumRequestError(f"Invalid JSON response from Trilium: {body[:200]}") from exc

    def create_note(self, parent_note_id: str, title: str, content: str = "", *, note_type: str = "code", mime: Optional[str] = "text/markdown") -> dict:
        payload = {
            "parentNoteId": parent_note_id,
            "title": title,
            "type": note_type,
        }
        if content:
            payload["content"] = content
        if mime:
            payload["mime"] = mime
        return self._request("POST", "create-note", payload)

    def create_folder(self, parent_note_id: str, title: str) -> Optional[str]:
        res = self.create_note(parent_note_id, title, content="", note_type="book", mime=None)
        note = res.get("note") if isinstance(res, dict) else None
        return note.get("noteId") if note else None

    def create_label(self, note_id: str, name: str, value: Optional[str] = None) -> dict:
        payload = {
            "noteId": note_id,
            "type": "label",
            "name": name,
            "value": value or "",
            "isInheritable": False,
        }
        return self._request("POST", "attributes", payload)


def load_mapping(mapping_path: Path) -> dict:
    if mapping_path.exists():
        try:
            return json.loads(mapping_path.read_text(encoding="utf-8"))
        except Exception:  # pragma: no cover - defensive path
            return {}
    return {}


def save_mapping(mapping_path: Path, mapping: dict) -> None:
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")


class TriliumImporter:
    """Handles idempotent import of markdown sessions into Trilium."""

    def __init__(
        self,
        client: TriliumClient,
        parent_note_id: str,
        mapping: dict,
        mapping_path: Path,
        *,
        chats_folder_name: str = "Chats",
        dry_run: bool = False,
    ):
        self.client = client
        self.parent_note_id = parent_note_id
        self.mapping = mapping if isinstance(mapping, dict) else {}
        self.mapping_path = mapping_path
        self.chats_folder_name = chats_folder_name
        self.dry_run = dry_run

        self.mapping.setdefault("_folders_", {})
        self._folder_cache = self.mapping["_folders_"]
        self._chats_folder_id: Optional[str] = None

    # Public API -------------------------------------------------------------

    def import_session(self, session: MarkdownSession) -> Optional[str]:
        """Import a single markdown session into Trilium.

        Returns the created noteId (or None if skipped/dry-run).
        """
        key = self._mapping_key(session)
        existing = self.mapping.get(key, {})
        if existing.get("hash") == session.content_hash:
            return existing.get("noteId")

        if self.dry_run:
            # Store prospective metadata for visibility, but do not call Trilium.
            self.mapping[key] = {
                "title": session.title,
                "noteId": None,
                "workspace": session.workspace,
                "host": session.host,
                "hash": session.content_hash,
                "mtime": session.mtime,
                "filename": session.filename,
                "path": session.source_path,
            }
            save_mapping(self.mapping_path, self.mapping)
            return None

        parent_for_host = self._ensure_host_folder(session.host)
        create_res = self.client.create_note(parent_for_host, session.title, session.content)
        note_info = create_res.get("note") if isinstance(create_res, dict) else None
        note_id = note_info.get("noteId") if note_info else None
        if not note_id:
            raise TriliumRequestError(f"Trilium did not return noteId for {session.source_path}: {create_res}")

        # Apply labels (best effort).
        try:
            self.client.create_label(note_id, "host", session.host)
        except TriliumRequestError:
            pass
        try:
            self.client.create_label(note_id, "workspace", session.workspace)
        except TriliumRequestError:
            pass

        self.mapping[key] = {
            "title": session.title,
            "noteId": note_id,
            "workspace": session.workspace,
            "host": session.host,
            "hash": session.content_hash,
            "mtime": session.mtime,
            "filename": session.filename,
            "path": session.source_path,
        }
        save_mapping(self.mapping_path, self.mapping)
        return note_id

    # Internal helpers -------------------------------------------------------

    def _ensure_chats_folder(self) -> Optional[str]:
        if not self.chats_folder_name:
            return None

        cache_key = f"{self.parent_note_id}:{self.chats_folder_name}"
        if cache_key in self._folder_cache:
            self._chats_folder_id = self._folder_cache[cache_key]
            return self._chats_folder_id

        if self.dry_run:
            return None

        note_id = self.client.create_folder(self.parent_note_id, self.chats_folder_name)
        if note_id:
            self._folder_cache[cache_key] = note_id
            save_mapping(self.mapping_path, self.mapping)
        self._chats_folder_id = note_id
        return note_id

    def _ensure_host_folder(self, host_label: str) -> str:
        if self.chats_folder_name:
            chats_folder = self._chats_folder_id or self._ensure_chats_folder()
            parent = chats_folder or self.parent_note_id
        else:
            parent = self.parent_note_id

        cache_key = f"{parent}:{host_label}"
        if cache_key in self._folder_cache:
            return self._folder_cache[cache_key]

        if self.dry_run:
            return parent

        note_id = self.client.create_folder(parent, host_label)
        if note_id:
            self._folder_cache[cache_key] = note_id
            save_mapping(self.mapping_path, self.mapping)
            return note_id
        return parent

    @staticmethod
    def _mapping_key(session: MarkdownSession) -> str:
        return session.session_id or session.source_path
