/**
 * Main entry point for 1mcp
 * Uses official @modelcontextprotocol/sdk with streamable-http transport
 */
/**
 * Command line options interface
 */
interface CLIOptions {
    port: number;
    host: string;
    cors: boolean;
    config?: string;
}
/**
 * Main MCP Hub application using official SDK
 */
export declare class McpHub {
    private readonly options;
    private server;
    private capabilityRegistry;
    private upstreamManager;
    private httpServer?;
    private isShuttingDown;
    constructor(options: CLIOptions);
    /**
     * Set up MCP request handlers
     */
    private setupRequestHandlers;
    /**
     * Route tool call to appropriate upstream server
     */
    private routeToolCall;
    /**
     * Route resource read to appropriate upstream server
     */
    private routeResourceRead;
    /**
     * Route prompt get to appropriate upstream server
     */
    private routePromptGet;
    /**
     * Start the hub with streamable-http transport (fast startup mode)
     */
    start(): Promise<void>;
    /**
     * Start watching configuration file for changes
     */
    private startConfigFileWatcher;
    /**
     * Copy request handlers from main server to connection server
     */
    private copyRequestHandlers;
    /**
     * Start Streamable HTTP transport
     */
    private startStreamableHttp;
    /**
     * Check if the request is an initialize request
     */
    private isInitializeRequest;
    /**
     * Get hub statistics
     */
    private getStats;
    /**
     * Set up graceful shutdown
     */
    private setupGracefulShutdown;
    /**
     * Shutdown all components
     */
    shutdown(): Promise<void>;
    /**
     * Log startup summary
     */
    private logSummary;
}
export {};
