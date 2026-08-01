# 1mcp

A central proxy server that aggregates multiple upstream MCP (Model Context Protocol) servers, providing a unified interface for downstream clients using the official `@modelcontextprotocol/sdk`.

## Features

- **Streamable HTTP Protocol**: Uses official MCP SDK with streamable-http transport for reliable client connections
- **Capability Aggregation**: Automatically discovers and aggregates tools, resources, and prompts from upstream servers
- **Transparent Routing**: Routes requests to appropriate upstream servers based on prefixed capability names (`serverName___toolName`)
- **Multiple Client Support**: Serves multiple downstream clients simultaneously via HTTP sessions with automatic cleanup
- **Automatic Reconnection**: Handles upstream server disconnections with automatic retry and exponential backoff
- **Real-time Updates**: Live capability updates as upstream servers connect/disconnect
- **Fast Startup Mode**: Server starts immediately while upstream connections initialize in background
- **Dynamic Configuration**: Hot-reload configuration changes without restarting the server
- **Session Management**: 30-minute session timeout with automatic cleanup of inactive sessions

## Architecture

```
┌─────────────┐    ┌─────────────────┐    ┌─────────────┐
│  Downstream │    │                 │    │  Upstream   │
│   Client    │◄──►│      1mcp       │◄──►│   Server    │
│ (HTTP/MCP)  │    │ (streamable-    │    │ (stdio/sse/ │
└─────────────┘    │  http server)   │    │ streamable) │
                   │  ┌──────────────┤    └─────────────┘
┌─────────────┐    │  │ Capability   │    ┌─────────────┐
│  Downstream │    │  │ Registry     │    │  Upstream   │
│   Client    │◄──►│  │              │◄──►│   Server    │
│ (HTTP/MCP)  │    │  │              │    │ (stdio/sse/ │
└─────────────┘    │  ├──────────────┤    │ streamable) │
                   │  │ Request      │    └─────────────┘
┌─────────────┐    │  │ Router       │    ┌─────────────┐
│  Downstream │    │  │              │    │  Upstream   │
│   Client    │◄──►│  │ Session      │    │   Server    │
│ (HTTP/MCP)  │    │  │ Manager      │◄──►│ (stdio/sse/ │
└─────────────┘    │  │              │    │ streamable) │
                   │  └──────────────┤    └─────────────┘
                   │  │ Config       │    ┌─────────────┐
                   │  │ Watcher      │    │  Upstream   │
                   │  │              │    │   Server    │
                   │  │              │◄──►│ (stdio/sse/ │
                   │  └──────────────┤    │ streamable) │
                   └─────────────────┘    └─────────────┘
```

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Setup

1. Clone and install dependencies:
```bash
git clone <repository-url>
cd 1mcp
npm install
```

2. Build the project:
```bash
npm run build
```

3. Create configuration file:
```bash
cp config/mcp_servers.json.example config/mcp_servers.json
```

## Configuration

Edit `config/mcp_servers.json` to configure your upstream servers:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "crawl4ai": {
      "type": "sse",
      "url": "http://localhost:11235/mcp/sse"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
    },
    "streamable-server": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Dynamic Configuration

1mcp supports **hot-reloading** of configuration changes. You can add, remove, or modify upstream servers without restarting the server:

1. **Add a new server**: Simply add a new entry to `mcp_servers.json` and save the file
2. **Remove a server**: Delete the server entry from the configuration file
3. **Update server config**: Modify any server configuration and save

The server will automatically:
- ✅ Detect configuration changes
- ✅ Connect to new servers
- ✅ Remove disconnected servers
- ✅ Update existing server configurations
- ✅ Notify connected clients of capability changes

**Example**: Add a new server while 1mcp is running:
```json
{
  "mcpServers": {
    "existing-server": { ... },
    "new-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["@new/mcp-server"]
    }
  }
}
```

After saving the file, you'll see:
```
📝 Configuration file changed: /path/to/config/mcp_servers.json
🔄 Configuration file changed, updating upstream connections...
📋 Configuration changes detected:
  ➕ Servers to add: 1
  ➖ Servers to remove: 0
  🔄 Servers to update: 0
➕ Adding new server: new-server
✅ Added server: new-server
📊 Configuration update complete (1234ms):
  ✅ Removed: 0 servers
  ✅ Updated: 0 servers
  ✅ Added: 1 servers
  ❌ Failed to add: 0 servers
✅ Configuration update completed successfully
```

### Server Types

1mcp supports all upstream server protocols via their native transports, while providing a unified streamable-http interface to downstream clients.

#### stdio servers (Default)
For servers that communicate via stdin/stdout:
```json
{
  "command": "node",
  "args": ["server.js"],
  "env": {
    "DEBUG": "1"
  },
  "cwd": "/optional/working/directory"
}
```

#### SSE servers
For servers using Server-Sent Events:
```json
{
  "type": "sse",
  "url": "http://localhost:8080/mcp/sse",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

#### streamable-http servers
For servers using streamable HTTP transport:
```json
{
  "type": "streamable-http", 
  "url": "http://localhost:8080/mcp",
  "headers": {
    "X-API-Key": "your-key"
  }
}
```

#### Auto-detection
The system can automatically detect transport type:
```json
{
  "type": "auto",
  "url": "http://localhost:8080/mcp"
}
```

## Usage

### Starting the Server

Start the 1mcp server:
```bash
npm start
# or
node dist/main.js
```

The server provides fast startup mode - it starts immediately on port 3000 while upstream connections initialize in the background.

### Command Line Options

```bash
Usage: node dist/main.js [options]

Options:
  --port=<number>     Server port (default: 3000)
  --host=<string>     Server host (default: localhost)
  --no-cors           Disable CORS (default: enabled)
  --config=<path>     Configuration file path (default: config/mcp_servers.json)
  --help, -h          Show this help message

Examples:
  node dist/main.js                                    # Start with default settings
  node dist/main.js --port=8080 --host=0.0.0.0       # Custom port and host
  node dist/main.js --config=./custom-config.json     # Custom config file
  node dist/main.js --port=3001 --no-cors             # Custom port, no CORS
```

### Available Endpoints

When the server starts, it provides these endpoints:
- `POST /mcp` - Main MCP protocol endpoint (streamable-http)
- `GET /health` - Health check and statistics
- `GET /mcp/info` - Server information and capabilities

## How It Works

### Capability Discovery

1. **Connection**: 1mcp connects to each configured upstream server using their native protocols
2. **Discovery**: Calls `tools/list`, `resources/list`, and `prompts/list` on each server
3. **Registration**: Registers capabilities with server name prefix (e.g., `serverName___toolName`)
4. **Serving**: Provides aggregated capabilities to downstream clients via streamable-http

### Request Routing

1. **Prefix Parsing**: Extracts server name from prefixed capability name using `___` separator
2. **Validation**: Verifies capability exists and server is connected
3. **Forwarding**: Removes prefix and forwards request to upstream server
4. **Response**: Returns upstream response to downstream client

### Dynamic Configuration Management

1. **File Watching**: Monitors `mcp_servers.json` for changes using Node.js file watcher
2. **Change Detection**: Detects additions, removals, and modifications to server configurations
3. **Connection Management**: Automatically connects to new servers and disconnects from removed ones
4. **Capability Updates**: Re-registers capabilities when servers are added/removed
5. **Client Notification**: Notifies connected clients of capability changes via `listChanged` events

### Session Management

- Each client connection gets a unique session ID
- Sessions persist indefinitely (no timeout or cleanup)
- Session state maintained in memory with connection pooling
- Streamable HTTP transport provides reliable bidirectional communication

### Example Flow

```json
// Client requests tool: "playwright___click"
{
  "id": 1,
  "method": "tools/call", 
  "params": {
    "name": "playwright___click",
    "arguments": { "selector": "#button" }
  }
}

// 1mcp routes to "playwright" server with original name "click"
{
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "click", 
    "arguments": { "selector": "#button" }
  }
}
```

## API Endpoints

### Health Check
```bash
GET /health
```
Returns server status, statistics, and connection information:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "stats": {
    "totalTools": 15,
    "totalResources": 5,
    "totalPrompts": 3,
    "connectedServers": 4,
    "upstreamServers": ["playwright", "filesystem", "crawl4ai"]
  },
  "transport": "streamable-http",
  "port": 3000
}
```

### Server Information  
```bash
GET /mcp/info
```
Returns server capabilities and endpoint information:
```json
{
  "name": "1mcp",
  "version": "1.0.0",
  "transport": "streamable-http",
  "capabilities": {
    "totalTools": 15,
    "totalResources": 5,
    "totalPrompts": 3
  },
  "endpoints": {
    "mcp": "/mcp",
    "health": "/health",
    "info": "/mcp/info",
    "session-info": "/mcp/session-info"
  }
}
```

### MCP Protocol Endpoints

#### Streamable HTTP Protocol
```bash
POST /mcp
Content-Type: application/json
mcp-session-id: <session-id>

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

The server uses streamable-http transport with session management. Each client connection gets a unique session ID returned in the `mcp-session-id` header.

## Supported MCP Methods

1mcp supports all standard MCP protocol methods:

- `initialize` - Client initialization
- `tools/list` - List all aggregated tools
- `tools/call` - Call a specific tool
- `resources/list` - List all aggregated resources  
- `resources/read` - Read a specific resource
- `prompts/list` - List all aggregated prompts
- `prompts/get` - Get a specific prompt

## Development

### Project Structure

```
src/
├── connectors/           # Upstream server connectors
│   ├── BaseConnector.ts  # Abstract base class with common functionality
│   ├── StdioConnector.ts # stdio protocol support
│   ├── SseConnector.ts   # SSE protocol support  
│   ├── StreamableHttpConnector.ts # streamable-http support
│   └── AutoConnector.ts  # Auto-detection connector
├── utils/
│   └── transportDetector.ts # Transport type detection
├── CapabilityRegistry.ts # Tool/resource/prompt registration
├── ConfigLoader.ts       # Configuration file handling
├── RequestRouter.ts      # Request routing logic (legacy)
├── UpstreamManager.ts    # Upstream connection management
├── main.ts              # Main entry point with CLI handling
├── McpHubServer.ts      # Hub server implementation (alternative)
└── types.ts             # TypeScript definitions
```

### Scripts

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run in development mode with ts-node
npm start            # Start the compiled server
npm test             # Run Jest tests
npm run lint         # Run ESLint
npm run lint:fix     # Fix linting issues automatically
```

### Running Tests

```bash
npm test
```

### Key Components

- **CapabilityRegistry**: Manages registration and lookup of capabilities with prefixing
- **UpstreamManager**: Handles connection lifecycle, reconnection, and capability discovery
- **Connectors**: Protocol-specific implementations for different server types
- **Session Management**: HTTP session handling with automatic cleanup

## Troubleshooting

### Connection Issues

1. **Server not connecting**: 
   - Check server configuration and ensure the upstream server is running
   - Verify the server URL is accessible
   - Check server logs for detailed error messages

2. **Command not found**: 
   - Verify the command path and arguments in configuration
   - Ensure the MCP server package is installed

3. **Permission denied**: 
   - Check file permissions for stdio servers
   - Verify environment variables and working directories

### Port Conflicts

Change the port using command line options:
```bash
node dist/main.js --port=8080
```

### Debug Mode

Set environment variable for detailed logging:
```bash
DEBUG=1mcp:* npm start
```

### Common Issues

1. **Session timeouts**: Sessions automatically expire after 30 minutes of inactivity
2. **Capability prefixing**: All tools/resources are prefixed with `serverName___`
3. **Async initialization**: Upstream connections initialize in background after server starts

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run `npm run lint` and `npm test`
6. Submit a pull request

## Dependencies

- **@modelcontextprotocol/sdk**: Official MCP SDK for protocol handling
- **express**: HTTP server framework
- **eventsource**: SSE client support

## License

MIT License - see LICENSE file for details. 