# mcp-srv
Traefik + 1mcp stack for LAN-accessible MCP servers.

## Files
- docker-compose.yml
- config/mcp.json
- config/filesystem-connectors.json
- config/mcp_servers.json

## Configuration

### Environment Variables
The following environment variables control the system. Create a `.env` file with these values:

| Variable | Description |
|----------|-------------|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub token for GitHubCopilot MCP server |
| `TRILIUM_API_URL` | URL of your Trilium server (e.g., `https://trilium.example.com/etapi`) |
| `TRILIUM_API_TOKEN` | API token for Trilium server |
| `TAVILY_API_KEY` | API key for Tavily search |

### Filesystem Connectors
The `filesystem-connectors.json` uses environment variables for host configuration:

| Variable Prefix | Description |
|-----------------|-------------|
| `FS_MSI_` | Windows MSI host settings |
| `FS_DNS_` | DNS server settings |
| `FS_PROXMOX_` | Proxmox host settings |
| `FS_LXC_` | Docker LXC container settings |
| `FS_MCP_` | MCP server itself |
| `FS_VPN_` | VPN server settings |
| `FS_OIDC_` | OIDC server settings |
| `FS_SH_` | Shell server settings |
| `FS_MD_` | Media server settings |
| `FS_LOG_` | Log server settings |
| `FS_EDIACARIAN_` | Ediacarian server settings |
| `FS_WIN_` | Windows desktop settings |
| `FS_WSL_` | WSL desktop settings |
| `FS_WSL_LOCAL_` | Local WSL settings |

For each server, set:
- `_HOST` - IP address or hostname
- `_USER` - SSH username
- `_KEY_PATH` - SSH key path (default: `/ssh/id_ed25519`)
- `_ALLOWED_DIRS` - Comma-separated list of allowed directories
- `_PROFILE_STORAGE_PATH` - VS Code profile storage path
- `_WORKSPACE_STORAGE_ROOT` - VS Code workspace storage root

## Secrets
- TLS certificates are excluded from VCS (see `.gitignore`)
- Environment variables should be stored securely (not committed to the repository)
- Use `.env.example` as a template for your `.env` file

## Run
```bash
docker compose up -d
```

## See Also
- [1MCP Documentation](https://1mcp.com)
- [MCP Filesystem SSHFS](https://github.com/1mcp/mcp-filesystem-sshfs)
