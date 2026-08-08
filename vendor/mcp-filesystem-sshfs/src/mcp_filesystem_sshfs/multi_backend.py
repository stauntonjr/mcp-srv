"""Multi-backend MCP server for SSHFS-backed filesystem and chat tools.

This module exposes parameterized tools that accept a `store_id` to operate
against multiple configured SSH backends loaded from a connector JSON file.
"""

import argparse
import sys
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

from .connector_manager import ConnectorManager
from .trilium_sync import (
    MarkdownSession,
    TriliumClient,
    TriliumImporter,
    detect_title,
    load_mapping,
    parse_front_matter,
)


mcp = FastMCP("filesystem-sshfs-multi")

# Globals filled in main()
connector_mgr: Optional[ConnectorManager] = None


@mcp.tool()
async def list_stores() -> list:
    """Return a list of configured stores.

    Each item contains: id, label, host, allowed_dirs.

    Example:
        stores = await list_stores()
    """
    return connector_mgr.list_stores()


@mcp.tool()
async def list_directory(store_id: str, path: str) -> list:
    """List directory entries for `path` on the specified store.

    Parameters
    - store_id: id from `list_stores()`
    - path: remote path (must be within store's allowed_dirs)

    Example:
        await list_directory('msi', '/home/jrs/.specstory/history')
    """
    try:
        mgr = connector_mgr.get_manager(store_id)
    except KeyError:
        raise ValueError(f"Unknown store_id '{store_id}'. Call list_stores() to see valid ids")
    validator = connector_mgr.get_validator(store_id)
    validated = validator.validate_path(path)
    entries = await mgr.list_directory(validated)
    return entries


@mcp.tool()
async def read_text_file(store_id: str, path: str) -> str:
    """Read a text file from `store_id` at `path` and return UTF-8 text.

    Example:
        text = await read_text_file('msi', '/home/jrs/.specstory/history/2025-11-08.md')
    """
    try:
        mgr = connector_mgr.get_manager(store_id)
    except KeyError:
        raise ValueError(f"Unknown store_id '{store_id}'. Call list_stores() to see valid ids")
    validator = connector_mgr.get_validator(store_id)
    validated = validator.validate_path(path)
    raw = await mgr.read_file(validated)
    return raw.decode("utf-8")


@mcp.tool()
async def list_markdown_sessions(store_id: str, remote_dir: str) -> list:
    """List Markdown files (sessions) under `remote_dir` on the given store.

    Example:
        await list_markdown_sessions('msi', '/home/jrs/.specstory/history')
    """
    try:
        mgr = connector_mgr.get_manager(store_id)
    except KeyError:
        raise ValueError(f"Unknown store_id '{store_id}'. Call list_stores() to see valid ids")
    validator = connector_mgr.get_validator(store_id)
    validated = validator.validate_path(remote_dir)
    matches = await mgr.search_files(validated, "*.md", max_depth=3)
    return matches


@mcp.tool()
async def read_markdown(store_id: str, remote_path: str) -> str:
    """Read a Markdown file from a store and return its content.

    Example:
        md = await read_markdown('msi', '/home/jrs/.specstory/history/2025-11-08.md')
    """
    try:
        mgr = connector_mgr.get_manager(store_id)
    except KeyError:
        raise ValueError(f"Unknown store_id '{store_id}'. Call list_stores() to see valid ids")
    validator = connector_mgr.get_validator(store_id)
    validated = validator.validate_path(remote_path)
    raw = await mgr.read_file(validated)
    return raw.decode("utf-8")


@mcp.tool()
async def sync_directory_to_trilium(store_id: str, remote_dir: str, trilium_base: str, trilium_token: str, parent_note_id: str, mapping_path: str = "trilium_mapping.json", host_label: Optional[str] = None, workspace: str = "global") -> dict:
    """Sync Markdown chat transcripts into Trilium using idempotent mapping data.

    This tool now mirrors the behaviour of the legacy helper script: it parses
    front-matter metadata, creates `Chats/<host>` folders as needed, applies
    `host` and `workspace` labels, and persists a mapping file to avoid
    duplicate uploads.
    """
    try:
        mgr = connector_mgr.get_manager(store_id)
    except KeyError:
        raise ValueError(f"Unknown store_id '{store_id}'. Call list_stores() to see valid ids")
    cfg = connector_mgr.get_store_config(store_id)
    validator = connector_mgr.get_validator(store_id)
    validated_dir = validator.validate_path(remote_dir)

    entries = await mgr.search_files(validated_dir, "*.md", max_depth=3)

    mapping_file = Path(mapping_path).expanduser().resolve()
    mapping_file.parent.mkdir(parents=True, exist_ok=True)
    mapping = load_mapping(mapping_file)

    store_label = cfg.get("label") or cfg.get("id") or store_id
    effective_host = host_label or store_label
    client = TriliumClient(trilium_base, trilium_token)
    importer = TriliumImporter(client, parent_note_id, mapping, mapping_file)

    for remote_path in sorted(entries):
        try:
            raw = await mgr.read_file(remote_path)
            text = raw.decode("utf-8")
        except Exception:
            continue

        metadata = parse_front_matter(text)
        session_id = metadata.get("session_id") or remote_path
        workspace_value = metadata.get("workspace") or workspace
        title = detect_title(text, metadata, Path(remote_path).name)

        mtime = None
        try:
            info = await mgr.get_file_info(remote_path)
            mtime = info.get("mtime")
        except Exception:
            pass

        session = MarkdownSession(
            source_path=remote_path,
            content=text,
            session_id=session_id,
            title=title,
            host=effective_host,
            workspace=workspace_value,
            filename=Path(remote_path).name,
            mtime=mtime,
            metadata=metadata,
        )

        try:
            importer.import_session(session)
        except Exception:
            # Skip problematic sessions but continue processing others.
            continue

    return importer.mapping


@mcp.tool()
async def get_store_info(store_id: str) -> dict:
    """Return the connector configuration for a given store_id.

    This is the authoritative metadata agents should consult before making calls.
    Example:
        info = await get_store_info('msi')
    """
    try:
        cfg = connector_mgr.get_store_config(store_id)
    except KeyError:
        raise ValueError(f"Unknown store_id '{store_id}'. Call list_stores() to see valid ids")

    # return a sanitized view
    return {
        "id": cfg.get("id"),
        "label": cfg.get("label"),
        "host": cfg.get("host"),
        "allowed_dirs": cfg.get("allowed_dirs", []),
        "profile_storage_path": cfg.get("profile_storage_path"),
        "workspace_storage_root": cfg.get("workspace_storage_root"),
    }


@mcp.tool()
async def describe_tools() -> dict:
    """Return a machine-readable description of available tools, their parameters and examples.

    Agents (like Copilot Chat) can call this to learn how to call the MCP tools programmatically.
    """
    # safe defaults
    stores = connector_mgr.list_stores() if connector_mgr else []
    example_store = stores[0]["id"] if stores else "msi"

    tools = [
        {
            "name": "list_stores",
            "params": [],
            "returns": "list of {id,label,host,allowed_dirs}",
            "example": "await list_stores()",
        },
        {
            "name": "get_store_info",
            "params": ["store_id:str"],
            "returns": "dict with store metadata",
            "example": f"await get_store_info('{example_store}')",
        },
        {
            "name": "list_markdown_sessions",
            "params": ["store_id:str", "remote_dir:str"],
            "returns": "list of remote markdown file paths",
            "example": f"await list_markdown_sessions('{example_store}', '/home/jrs/.specstory/history')",
        },
        {
            "name": "read_markdown",
            "params": ["store_id:str", "remote_path:str"],
            "returns": "string (markdown content)",
            "example": f"await read_markdown('{example_store}', '/home/jrs/.specstory/history/2025-11-08.md')",
        },
        {
            "name": "sync_directory_to_trilium",
            "params": ["store_id:str", "remote_dir:str", "trilium_base:str", "trilium_token:str", "parent_note_id:str"],
            "returns": "mapping dict (noteId/hash)",
            "example": f"await sync_directory_to_trilium('{example_store}', '/home/jrs/.specstory/history', 'https://trilium/etapi', '<token>', 'RajY...')",
        },
    ]

    return {"tools": tools, "stores": stores}


def parse_args():
    parser = argparse.ArgumentParser(description="Multi-backend filesystem-sshfs MCP server")
    parser.add_argument("--connectors", required=True, help="Path to the connector JSON config")
    return parser.parse_args()


def main():
    global connector_mgr
    args = parse_args()
    connector_mgr = ConnectorManager(args.connectors)
    mcp.run()


if __name__ == "__main__":
    main()
