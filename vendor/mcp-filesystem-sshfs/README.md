# MCP Filesystem SSHFS Server

A Model Context Protocol (MCP) server that exposes remote filesystem and VS Code chat-history data over SSH using key-based authentication (asyncssh). The project provides two main tools:

- A filesystem MCP server for reading/writing files and listing directories over SSH/SFTP.
- A chat-history MCP server that reads VS Code chat transcripts from remote storage and optionally exports them to Trilium.

This README gives a concise overview, quick-start examples, installation, and development notes. For detailed reference see `DOCKER.md` and the source under `src/mcp_filesystem_sshfs/`.

## Features

- SSH key-based authentication (asyncssh)
- Read/write files, list and create directories, move/rename files
- Search files by glob patterns and fetch file metadata
- Browse VS Code chat history (profile and per-workspace stores)
- Optional Trilium export: converts chat sessions to Markdown and uploads them to Trilium Next ETAPI
- Docker-friendly for reproducible deployments

## Installation

Install from PyPI:

```bash
pip install mcp-filesystem-sshfs
```

For development (editable install):

```bash
git clone https://github.com/stauntonjr/mcp-filesystem-sshfs.git
cd mcp-filesystem-sshfs
pip install -e '.[dev]'
```

## Quick start — Filesystem server

After installation you should have a console script `mcp-filesystem-sshfs` (or run the module with `python -m mcp_filesystem_sshfs.filesystem`). Example:

```bash
mcp-filesystem-sshfs \
  --host remote-host.example.com \
  --username myuser \
  --key-path ~/.ssh/id_ed25519 \
  --allowed-dirs /home/myuser/projects,/var/www
```

Key CLI flags (filesystem): `--host`, `--username`, `--key-path`, `--allowed-dirs` (comma-separated). `--port` defaults to 22.

## Quick start — Chat history + Trilium export

Example to expose VS Code chat storage and enable Trilium export:

```bash
mcp-chat-history-sshfs \
  --host remote-host.example.com \
  --username myuser \
  --profile-storage-path /home/myuser/.vscode-server/data/User/globalStorage \
  --workspace-storage-root /home/myuser/.vscode-server/data/User/workspaceStorage \
  --allowed-dirs /home/myuser/.vscode-server/data/User/globalStorage,/home/myuser/.vscode-server/data/User/workspaceStorage \
  --trilium-api-url https://trilium.example.com/etapi \
  --trilium-api-token <token> \
  --trilium-parent-note-id <note-id>
```

Environment variables (optional): `TRILIUM_API_URL`, `TRILIUM_API_TOKEN`, `TRILIUM_CHAT_PARENT_ID`, `TRILIUM_CHAT_TAGS`, `CHAT_EXPORT_DIR`.

## Supported MCP tools (summary)

Filesystem server: `read_text_file`, `write_file`, `list_directory`, `create_directory`, `move_file`, `search_files`, `get_file_info`, `list_allowed_directories`.

Chat-history server: `list_chat_stores`, `list_chat_sessions`, `load_chat_session`, `export_chat_to_trilium`.

## Development & testing

Run tests locally:

```bash
pytest -q
```

Docker examples and instructions are in `DOCKER.md`.

## Security considerations

- Use SSH key-based auth only; avoid passwords for these services.
- Restrict exposed paths with `--allowed-dirs`.
- Use host-level controls and firewalls when exposing services to untrusted networks.

## License

MIT — see the `LICENSE` file for full text.
