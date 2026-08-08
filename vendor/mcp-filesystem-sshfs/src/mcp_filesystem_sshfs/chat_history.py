"""MCP tools for chat-history backed by Markdown files over SSH.

Provides MCP tools to list Markdown sessions, read a Markdown session,
and sync a Markdown file to Trilium Next (ETAPI).

This module is intended to be run as a standalone MCP server similar to
`server.py` and uses the repository's SSHConnectionManager and PathValidator.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from mcp.server.fastmcp import FastMCP

from .ssh_manager import SSHConnectionManager
from .path_validator import PathValidator


mcp = FastMCP("chat-history-sshfs")

# Globals populated in main()
ssh_manager: Optional[SSHConnectionManager] = None
path_validator: Optional[PathValidator] = None


def _trilium_request(base: str, token: str, method: str, path: str, payload: Optional[dict] = None) -> dict:
    base = base.rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    headers = {"Authorization": token}
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = Request(url, data=data, method=method.upper(), headers=headers)
    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore") if exc.fp else str(exc)
        raise RuntimeError(f"Trilium request failed ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Unable to reach Trilium at {url}: {exc}") from exc

    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        raise RuntimeError(f"Invalid JSON response from Trilium: {body[:200]}")


def _create_note(base: str, token: str, parent_note_id: str, title: str, markdown: str) -> dict:
    payload = {
        "parentNoteId": parent_note_id,
        "title": title,
        "type": "code",
        "mime": "text/markdown",
        "content": markdown,
    }
    return _trilium_request(base, token, "POST", "create-note", payload)


def _create_label(base: str, token: str, note_id: str, name: str, value: Optional[str] = None) -> dict:
    payload = {
        "noteId": note_id,
        "type": "label",
        "name": name,
        "value": value or "",
        "isInheritable": False,
    }
    return _trilium_request(base, token, "POST", "attributes", payload)


@mcp.tool()
async def list_markdown_sessions(path: str) -> list:
    """List Markdown files under a remote directory using SFTP.

    Returns a list of POSIX paths (strings) to markdown files matching *.md
    found under `path` (search depth limited by SSHConnectionManager.search_files).
    """
    validated = path_validator.validate_path(path)
    matches = await ssh_manager.search_files(validated, "*.md", max_depth=5)
    return matches


@mcp.tool()
async def read_markdown(path: str) -> str:
    """Read the full contents of a remote Markdown file and return it as UTF-8 text."""
    validated = path_validator.validate_path(path)
    raw = await ssh_manager.read_file(validated)
    return raw.decode("utf-8")


@mcp.tool()
async def sync_markdown_to_trilium(path: str, trilium_base: str, trilium_token: str, parent_note_id: str, host_label: str = "remote", workspace: str = "global") -> dict:
    """Read a Markdown file and create a Trilium note for it (returns note info dict).

    The function will attempt to create a note in Trilium and attach `host` and
    `workspace` labels. It returns the Trilium response dict.
    """
    validated = path_validator.validate_path(path)
    raw = await ssh_manager.read_file(validated)
    text = raw.decode("utf-8")

    # simple title detection: first H1 or filename
    title = None
    for line in text.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break
    if not title:
        title = Path(path).stem

    res = _create_note(trilium_base, trilium_token, parent_note_id, title, text)
    note_info = res.get("note") if isinstance(res, dict) else None
    note_id = note_info.get("noteId") if note_info else None
    if note_id:
        _create_label(trilium_base, trilium_token, note_id, "host", host_label)
        _create_label(trilium_base, trilium_token, note_id, "workspace", workspace)

    return res


def parse_args():
    parser = argparse.ArgumentParser(description="MCP Chat History (Markdown) - SSHFS-backed tools")
    parser.add_argument("--host", required=True, help="SSH server hostname or IP address")
    parser.add_argument("--username", required=True, help="SSH username")
    parser.add_argument("--port", type=int, default=22, help="SSH port (default: 22)")
    parser.add_argument("--key-path", help="Path to SSH private key file (default: ~/.ssh/id_rsa)")
    parser.add_argument("--allowed-dirs", required=True, help="Comma-separated list of allowed directories on remote server")
    return parser.parse_args()


def main():
    global ssh_manager, path_validator
    args = parse_args()
    allowed_dirs = [d.strip() for d in args.allowed_dirs.split(',') if d.strip()]
    if not allowed_dirs:
        print("Error: at least one allowed directory must be specified", file=sys.stderr)
        sys.exit(1)

    ssh_manager = SSHConnectionManager(host=args.host, username=args.username, port=args.port, key_path=args.key_path)
    path_validator = PathValidator(allowed_dirs)

    mcp.run()


if __name__ == "__main__":
    main()
