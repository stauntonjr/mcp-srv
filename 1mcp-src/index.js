import { McpHub } from './dist/main.js';

// Start the MCP hub
const hub = new McpHub({
    config: process.env.ONE_MCP_CONFIG || '/config/mcp_servers.json',
    host: process.env.ONE_MCP_HOST || '0.0.0.0',
    port: parseInt(process.env.ONE_MCP_PORT || '3000', 10),
    externalUrl: process.env.ONE_MCP_EXTERNAL_URL || 'http://localhost:3000',
    transport: process.env.ONE_MCP_TRANSPORT || 'http',
    trustProxy: process.env.ONE_MCP_TRUST_PROXY || '172.18.0.0/16',
    enableAsyncLoading: process.env.ONE_MCP_ENABLE_ASYNC === 'true',
});

hub.start();
