/**
 * Main entry point for 1mcp
 * Uses official @modelcontextprotocol/sdk with streamable-http transport
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { CapabilityRegistry } from './CapabilityRegistry.js';
import { ConfigLoader } from './ConfigLoader.js';
import { UpstreamManager } from './UpstreamManager.js';
/**
 * Parse command line arguments
 */
function parseArgs(args) {
    const options = {
        port: 3000,
        host: 'localhost',
        cors: true
    };
    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            showHelp();
            process.exit(0);
        }
        else if (arg.startsWith('--port=')) {
            options.port = parseInt(arg.split('=')[1], 10);
            if (isNaN(options.port) || options.port <= 0 || options.port > 65535) {
                throw new Error('Invalid port number. Must be between 1 and 65535.');
            }
        }
        else if (arg.startsWith('--host=')) {
            options.host = arg.split('=')[1];
            if (!options.host) {
                throw new Error('Host cannot be empty');
            }
        }
        else if (arg === '--no-cors') {
            options.cors = false;
        }
        else if (arg.startsWith('--config=')) {
            options.config = arg.split('=')[1];
        }
        else if (arg.startsWith('--')) {
            console.error(`Unknown option: ${arg}`);
            showHelp();
            process.exit(1);
        }
    }
    return options;
}
/**
 * Show help information
 */
function showHelp() {
    console.log(`
1mcp - A central proxy server that aggregates multiple upstream MCP servers

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

Endpoints:
  GET  /health        Health check and statistics
  GET  /mcp/info      Server information and capabilities
  POST /mcp           Main MCP protocol endpoint (streamable-http)

For more information, visit: https://github.com/your-repo/1mcp
`);
}
/**
 * Main MCP Hub application using official SDK
 */
export class McpHub {
    options;
    server;
    capabilityRegistry;
    upstreamManager;
    httpServer;
    isShuttingDown = false;
    constructor(options) {
        this.options = options;
        // Initialize capability registry
        this.capabilityRegistry = new CapabilityRegistry();
        // Initialize upstream manager
        this.upstreamManager = new UpstreamManager(this.capabilityRegistry);
        // Create MCP server with official SDK
        this.server = new Server({
            name: '1mcp',
            version: '1.0.0',
            description: 'A central proxy server that aggregates multiple upstream MCP servers'
        }, {
            capabilities: {
                tools: { listChanged: true },
                resources: { listChanged: true, subscribe: false },
                prompts: { listChanged: true },
                experimental: {
                    aggregation: true,
                    health: true
                }
            }
        });
        this.setupRequestHandlers();
    }
    /**
     * Set up MCP request handlers
     */
    setupRequestHandlers() {
        // Tools handlers
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const allTools = this.capabilityRegistry.getAllTools();
            const tools = allTools.map(registeredTool => ({
                name: registeredTool.prefixedName,
                description: registeredTool.description,
                inputSchema: registeredTool.parameters || {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }));
            console.log(`📋 Listing ${tools.length} aggregated tools`);
            return { tools };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name: prefixedName, arguments: args } = request.params;
            if (!prefixedName || typeof prefixedName !== 'string') {
                throw new Error('Tool name is required');
            }
            // Route the tool call to upstream server
            const routeInfo = this.routeToolCall(prefixedName);
            if (!routeInfo) {
                throw new Error(`Tool not found or server unavailable: ${prefixedName}`);
            }
            const upstreamRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: routeInfo.originalName,
                    arguments: args
                }
            };
            console.log(`🔧 Calling tool ${routeInfo.originalName} on ${routeInfo.serverName}`);
            const response = await this.upstreamManager.routeMessage(routeInfo.serverName, upstreamRequest);
            if ('error' in response) {
                throw new Error(response.error.message);
            }
            return response.result;
        });
        // Resources handlers
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            const allResources = this.capabilityRegistry.getAllResources();
            const resources = allResources.map(registeredResource => ({
                uri: registeredResource.prefixedUri,
                name: registeredResource.name,
                description: registeredResource.description,
                mimeType: registeredResource.mimeType
            }));
            console.log(`📚 Listing ${resources.length} aggregated resources`);
            return { resources };
        });
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri: prefixedUri } = request.params;
            if (!prefixedUri || typeof prefixedUri !== 'string') {
                throw new Error('Resource URI is required');
            }
            // Route the resource read to upstream server
            const routeInfo = this.routeResourceRead(prefixedUri);
            if (!routeInfo) {
                throw new Error(`Resource not found or server unavailable: ${prefixedUri}`);
            }
            const upstreamRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'resources/read',
                params: {
                    uri: routeInfo.originalUri
                }
            };
            console.log(`📖 Reading resource ${routeInfo.originalUri} from ${routeInfo.serverName}`);
            const response = await this.upstreamManager.routeMessage(routeInfo.serverName, upstreamRequest);
            if ('error' in response) {
                throw new Error(response.error.message);
            }
            return response.result;
        });
        // Prompts handlers
        this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
            const allPrompts = this.capabilityRegistry.getAllPrompts();
            const prompts = allPrompts.map(registeredPrompt => ({
                name: registeredPrompt.prefixedName,
                description: registeredPrompt.description,
                arguments: registeredPrompt.arguments
            }));
            console.log(`💬 Listing ${prompts.length} aggregated prompts`);
            return { prompts };
        });
        this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name: prefixedName, arguments: args } = request.params;
            if (!prefixedName || typeof prefixedName !== 'string') {
                throw new Error('Prompt name is required');
            }
            // Route the prompt get to upstream server
            const routeInfo = this.routePromptGet(prefixedName);
            if (!routeInfo) {
                throw new Error(`Prompt not found or server unavailable: ${prefixedName}`);
            }
            const upstreamRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'prompts/get',
                params: {
                    name: routeInfo.originalName,
                    arguments: args
                }
            };
            console.log(`💬 Getting prompt ${routeInfo.originalName} from ${routeInfo.serverName}`);
            const response = await this.upstreamManager.routeMessage(routeInfo.serverName, upstreamRequest);
            if ('error' in response) {
                throw new Error(response.error.message);
            }
            return response.result;
        });
    }
    /**
     * Route tool call to appropriate upstream server
     */
    routeToolCall(prefixedName) {
        const allTools = this.capabilityRegistry.getAllTools();
        const tool = allTools.find(t => t.prefixedName === prefixedName);
        if (!tool)
            return null;
        const connector = this.upstreamManager.getConnector(tool.serverName);
        if (!connector?.isConnected())
            return null;
        return {
            serverName: tool.serverName,
            originalName: tool.originalName
        };
    }
    /**
     * Route resource read to appropriate upstream server
     */
    routeResourceRead(prefixedUri) {
        const allResources = this.capabilityRegistry.getAllResources();
        const resource = allResources.find(r => r.prefixedUri === prefixedUri);
        if (!resource)
            return null;
        const connector = this.upstreamManager.getConnector(resource.serverName);
        if (!connector?.isConnected())
            return null;
        return {
            serverName: resource.serverName,
            originalUri: resource.originalUri
        };
    }
    /**
     * Route prompt get to appropriate upstream server
     */
    routePromptGet(prefixedName) {
        const allPrompts = this.capabilityRegistry.getAllPrompts();
        const prompt = allPrompts.find(p => p.prefixedName === prefixedName);
        if (!prompt)
            return null;
        const connector = this.upstreamManager.getConnector(prompt.serverName);
        if (!connector?.isConnected())
            return null;
        return {
            serverName: prompt.serverName,
            originalName: prompt.originalName
        };
    }
    /**
     * Start the hub with streamable-http transport (fast startup mode)
     */
    async start() {
        const startTime = Date.now();
        console.log(`🚀 Starting 1mcp with streamable-http transport (fast startup mode)...`);
        try {
            // Load configuration first
            const configStart = Date.now();
            const config = await ConfigLoader.load(this.options.config);
            console.log(`📋 Configuration loaded (${Date.now() - configStart}ms) - ${Object.keys(config.mcpServers).length} servers configured`);
            // Start HTTP server immediately for fast startup
            const httpStart = Date.now();
            await this.startStreamableHttp();
            console.log(`🌐 HTTP server started (${Date.now() - httpStart}ms)`);
            // Initialize upstream connections in parallel with server startup
            const connectStart = Date.now();
            this.upstreamManager.initializeConnections(config).then(() => {
                console.log(`✅ Upstream connections initialized (${Date.now() - connectStart}ms)`);
                this.logSummary();
            }).catch(error => {
                console.error(`⚠️  Some upstream connections failed:`, error);
                // Still log summary even if some connections fail
                this.logSummary();
            });
            // Start watching configuration file for changes
            if (this.options.config) {
                await this.startConfigFileWatcher();
            }
            else {
                // Try to watch the default config file
                const defaultConfigPath = 'config/mcp_servers.json';
                try {
                    await this.startConfigFileWatcher(defaultConfigPath);
                }
                catch (error) {
                    console.log(`ℹ️  Configuration file watching not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            console.log(`⚡ 1mcp started successfully (${Date.now() - startTime}ms) - capability discovery continues in background`);
        }
        catch (error) {
            console.error(`❌ Failed to start 1mcp:`, error);
            throw error;
        }
    }
    /**
     * Start watching configuration file for changes
     */
    async startConfigFileWatcher(configPath) {
        const pathToWatch = configPath || this.options.config || 'config/mcp_servers.json';
        await ConfigLoader.startWatching(pathToWatch, async (newConfig) => {
            try {
                console.log(`🔄 Configuration file changed, updating upstream connections...`);
                // Update upstream connections based on new configuration
                await this.upstreamManager.updateConnections(newConfig);
                // Log updated summary
                this.logSummary();
                console.log(`✅ Configuration update completed successfully`);
            }
            catch (error) {
                console.error(`❌ Failed to update configuration:`, error);
            }
        });
    }
    /**
     * Copy request handlers from main server to connection server
     */
    copyRequestHandlers(targetServer) {
        // Set up the same request handlers on the new server instance
        // Tools handlers
        targetServer.setRequestHandler(ListToolsRequestSchema, async () => {
            const allTools = this.capabilityRegistry.getAllTools();
            const tools = allTools.map(registeredTool => ({
                name: registeredTool.prefixedName,
                description: registeredTool.description,
                inputSchema: registeredTool.parameters || {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }));
            console.log(`📋 Listing ${tools.length} aggregated tools`);
            return { tools };
        });
        targetServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name: prefixedName, arguments: args } = request.params;
            if (!prefixedName || typeof prefixedName !== 'string') {
                throw new Error('Tool name is required');
            }
            const routeInfo = this.routeToolCall(prefixedName);
            if (!routeInfo) {
                throw new Error(`Tool not found or server unavailable: ${prefixedName}`);
            }
            const upstreamRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: routeInfo.originalName,
                    arguments: args
                }
            };
            console.log(`🔧 Calling tool ${routeInfo.originalName} on ${routeInfo.serverName}`);
            const response = await this.upstreamManager.routeMessage(routeInfo.serverName, upstreamRequest);
            if ('error' in response) {
                throw new Error(response.error.message);
            }
            return response.result;
        });
        // Resources handlers
        targetServer.setRequestHandler(ListResourcesRequestSchema, async () => {
            const allResources = this.capabilityRegistry.getAllResources();
            const resources = allResources.map(resource => ({
                uri: resource.prefixedUri,
                name: resource.name,
                description: resource.description,
                mimeType: resource.mimeType
            }));
            console.log(`📂 Listing ${resources.length} aggregated resources`);
            return { resources };
        });
        targetServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri: prefixedUri } = request.params;
            if (!prefixedUri || typeof prefixedUri !== 'string') {
                throw new Error('Resource URI is required');
            }
            const routeInfo = this.routeResourceRead(prefixedUri);
            if (!routeInfo) {
                throw new Error(`Resource not found or server unavailable: ${prefixedUri}`);
            }
            const upstreamRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'resources/read',
                params: {
                    uri: routeInfo.originalUri
                }
            };
            console.log(`📖 Reading resource ${routeInfo.originalUri} from ${routeInfo.serverName}`);
            const response = await this.upstreamManager.routeMessage(routeInfo.serverName, upstreamRequest);
            if ('error' in response) {
                throw new Error(response.error.message);
            }
            return response.result;
        });
        // Prompts handlers
        targetServer.setRequestHandler(ListPromptsRequestSchema, async () => {
            const allPrompts = this.capabilityRegistry.getAllPrompts();
            const prompts = allPrompts.map(prompt => ({
                name: prompt.prefixedName,
                description: prompt.description,
                arguments: prompt.arguments
            }));
            console.log(`📝 Listing ${prompts.length} aggregated prompts`);
            return { prompts };
        });
        targetServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name: prefixedName, arguments: args } = request.params;
            if (!prefixedName || typeof prefixedName !== 'string') {
                throw new Error('Prompt name is required');
            }
            const routeInfo = this.routePromptGet(prefixedName);
            if (!routeInfo) {
                throw new Error(`Prompt not found or server unavailable: ${prefixedName}`);
            }
            const upstreamRequest = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'prompts/get',
                params: {
                    name: routeInfo.originalName,
                    arguments: args
                }
            };
            console.log(`📝 Getting prompt ${routeInfo.originalName} from ${routeInfo.serverName}`);
            const response = await this.upstreamManager.routeMessage(routeInfo.serverName, upstreamRequest);
            if ('error' in response) {
                throw new Error(response.error.message);
            }
            return response.result;
        });
    }
    /**
     * Start Streamable HTTP transport
     */
    async startStreamableHttp() {
        const app = express();
        // Enable CORS if configured
        if (this.options.cors) {
            app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-version');
                if (req.method === 'OPTIONS') {
                    res.sendStatus(200);
                }
                else {
                    next();
                }
            });
        }
        // NOTE: Do NOT use express.json() middleware with StreamableHTTPServerTransport
        // The transport handles request body parsing internally
        // Add health endpoint
        app.get('/health', (req, res) => {
            const stats = this.getStats();
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                stats,
                transport: 'streamable-http',
                port: this.options.port || 3000
            });
        });
        // Add info endpoint
        app.get('/mcp/info', (req, res) => {
            const stats = this.getStats();
            res.json({
                name: '1mcp',
                version: '1.0.0',
                transport: 'streamable-http',
                capabilities: stats,
                endpoints: {
                    mcp: '/mcp',
                    health: '/health',
                    info: '/mcp/info'
                }
            });
        });
        // Store active Streamable HTTP connections
        const activeConnections = new Map();
        // Handle Streamable HTTP requests - create new server instance for each session
        app.all('/mcp', async (req, res) => {
            try {
                // Extract or generate session ID
                let sessionId = req.headers['mcp-session-id'];
                // Check if this is a new session (no session ID or initialize request)
                const isNewSession = !sessionId || this.isInitializeRequest(req);
                if (isNewSession) {
                    // Generate new session ID
                    sessionId = Math.random().toString(36).substring(2, 15);
                    // Create new server instance for this session
                    const sessionServer = new Server({
                        name: '1mcp',
                        version: '1.0.0',
                    }, {
                        capabilities: {
                            tools: { listChanged: true },
                            resources: { listChanged: true, subscribe: false },
                            prompts: { listChanged: true },
                            experimental: { aggregation: true }
                        }
                    });
                    // Copy all request handlers from main server
                    this.copyRequestHandlers(sessionServer);
                    // Create transport for this session
                    const transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => sessionId
                    });
                    // Connect the server to the transport
                    await sessionServer.connect(transport);
                    // Store the connection
                    activeConnections.set(sessionId, { transport, server: sessionServer, lastActivity: new Date() });
                    console.log(`📡 New Streamable HTTP session established: ${sessionId}`);
                    // Set session ID in response header
                    res.setHeader('mcp-session-id', sessionId);
                }
                // Get the appropriate transport for this session
                const connection = activeConnections.get(sessionId);
                if (!connection) {
                    console.warn(`⚠️  Session not found: ${sessionId}. Active sessions: ${Array.from(activeConnections.keys()).join(', ')}`);
                    res.status(400).json({
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32602,
                            message: `Invalid session ID: ${sessionId}`
                        }
                    });
                    return;
                }
                // Update last activity time
                connection.lastActivity = new Date();
                // Handle the request with the session-specific transport
                await connection.transport.handleRequest(req, res);
            }
            catch (error) {
                console.error('❌ Failed to handle Streamable HTTP request:', error);
                res.status(500).json({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32603,
                        message: 'Internal server error'
                    }
                });
            }
        });
        const port = this.options.port || 3000;
        this.httpServer = app.listen(port, () => {
            console.log(`🌐 MCP Streamable HTTP Server started on http://localhost:${port}`);
            console.log(`🌐 MCP endpoint: http://localhost:${port}/mcp`);
        });
        this.setupGracefulShutdown();
    }
    /**
     * Check if the request is an initialize request
     */
    isInitializeRequest(req) {
        try {
            // We need to peek at the request body without consuming it
            // This is a simple heuristic - if there's no session ID and it's a POST, treat as new session
            return req.method === 'POST' && !req.headers['mcp-session-id'];
        }
        catch {
            return false;
        }
    }
    /**
     * Get hub statistics
     */
    getStats() {
        const summary = this.capabilityRegistry.getSummary();
        const connectedServers = this.upstreamManager.getConnectedServers();
        return {
            totalTools: summary.totalTools,
            totalResources: summary.totalResources,
            totalPrompts: summary.totalPrompts,
            connectedServers: connectedServers.length
        };
    }
    /**
     * Set up graceful shutdown
     */
    setupGracefulShutdown() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
        signals.forEach(signal => {
            process.on(signal, async () => {
                if (this.isShuttingDown)
                    return;
                this.isShuttingDown = true;
                console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
                await this.shutdown();
                process.exit(0);
            });
        });
    }
    /**
     * Shutdown all components
     */
    async shutdown() {
        if (this.isShuttingDown)
            return;
        this.isShuttingDown = true;
        console.log('🔄 Shutting down 1mcp...');
        const promises = [];
        // Stop all configuration file watchers
        ConfigLoader.stopAllWatchers();
        if (this.httpServer) {
            promises.push(new Promise(resolve => this.httpServer.close(() => resolve())));
        }
        if (this.upstreamManager) {
            promises.push(this.upstreamManager.shutdown());
        }
        try {
            await Promise.all(promises);
            console.log('✅ 1mcp shutdown completed');
        }
        catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
    /**
     * Log startup summary
     */
    logSummary() {
        const stats = this.upstreamManager.getStats();
        console.log('\n📊 1mcp Summary:');
        console.log(`  • Connected servers: ${stats.connectedServers.length}`);
        console.log(`  • Total tools: ${stats.totalTools}`);
        console.log(`  • Total resources: ${stats.totalResources}`);
        console.log(`  • Total prompts: ${stats.totalPrompts}`);
        if (stats.connectedServers.length > 0) {
            console.log('\n🔧 Connected Servers:');
            stats.connectedServers.forEach(server => {
                console.log(`  • ${server.name}: ${server.toolCount} tools, ${server.resourceCount} resources, ${server.promptCount} prompts`);
            });
        }
        console.log('');
    }
}
// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options = parseArgs(args);
    const hub = new McpHub(options);
    // Start with streamable-http transport (only supported transport)
    hub.start().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=main.js.map