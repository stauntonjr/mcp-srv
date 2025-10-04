# mcp-srv
Traefik + 1mcp stack for LAN-accessible MCP servers.

## Files
- docker-compose.yml
- config/mcp.json
- dynamic/traefik.yml

## Secrets
- Provide GITHUB_PERSONAL_ACCESS_TOKEN via .env (see .env.example).
- TLS certs/keys are excluded from VCS.

## Run
docker compose up -d
