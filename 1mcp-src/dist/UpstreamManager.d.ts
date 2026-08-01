/**
 * Upstream Manager for 1mcp
 * Manages the lifecycle of all upstream server connections and coordinates capability discovery
 */
import { EventEmitter } from 'events';
import { BaseConnector } from './connectors/BaseConnector.js';
import { CapabilityRegistry, McpServersConfig, ServerConnection, UpstreamServerConfig } from './types.js';
export declare class UpstreamManager extends EventEmitter {
    private readonly capabilityRegistry;
    private readonly maxRetries;
    private readonly retryDelay;
    private connectors;
    private connections;
    private reconnectTimeouts;
    constructor(capabilityRegistry: CapabilityRegistry, maxRetries?: number, retryDelay?: number);
    /**
   * Initialize all upstream connections from configuration
   */
    initializeConnections(config: McpServersConfig): Promise<void>;
    /**
     * Update connections based on new configuration
     * This method handles adding new servers, removing old ones, and updating existing ones
     */
    updateConnections(newConfig: McpServersConfig): Promise<void>;
    /**
     * Add a new server connection with timing
     */
    private addServerWithTiming;
    /**
     * Add a new server connection
     */
    addServer(name: string, config: UpstreamServerConfig): Promise<void>;
    /**
     * Remove a server connection
     */
    removeServer(name: string): Promise<void>;
    /**
     * Connect to a specific server
     */
    connectServer(name: string): Promise<void>;
    /**
     * Disconnect from a specific server
     */
    disconnectServer(name: string): Promise<void>;
    /**
     * Get a connector by name
     */
    getConnector(name: string): BaseConnector | undefined;
    /**
     * Get connection information for a server
     */
    getConnection(name: string): ServerConnection | undefined;
    /**
     * Get all server names
     */
    getServerNames(): string[];
    /**
     * Get all connections
     */
    getAllConnections(): ServerConnection[];
    /**
     * Get connected servers
     */
    getConnectedServers(): string[];
    /**
     * Shutdown all connections
     */
    shutdown(): Promise<void>;
    /**
     * Create the appropriate connector for a server configuration
     */
    private createConnector;
    /**
     * Set up event handlers for a connector
     */
    private setupConnectorHandlers;
    /**
     * Update connection status
     */
    private updateConnectionStatus;
    /**
     * Discover capabilities for a server
     */
    private discoverServerCapabilities;
    /**
     * Schedule reconnection for a server
     */
    private scheduleReconnection;
    /**
     * Route a message to a specific upstream server
     */
    routeMessage(serverName: string, message: any): Promise<any>;
    /**
     * Get connection statistics
     */
    getStats(): {
        connectedServers: {
            name: string;
            toolCount: number;
            resourceCount: number;
            promptCount: number;
        }[];
        totalTools: number;
        totalResources: number;
        totalPrompts: number;
    };
}
