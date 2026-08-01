/**
 * Upstream Manager for 1mcp
 * Manages the lifecycle of all upstream server connections and coordinates capability discovery
 */

import { EventEmitter } from 'events';
import { AutoConnector } from './connectors/AutoConnector.js';
import { BaseConnector } from './connectors/BaseConnector.js';
import { StdioConnector } from './connectors/StdioConnector.js';
import { StreamableHttpConnector } from './connectors/StreamableHttpConnector.js';
import {
    CapabilityRegistry,
    McpServersConfig,
    ServerConnection,
    ServerStatus,
    UpstreamServerConfig
} from './types.js';

export class UpstreamManager extends EventEmitter {
  private connectors = new Map<string, BaseConnector>();
  private connections = new Map<string, ServerConnection>();
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();
  
  constructor(
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly maxRetries = 3,
    private readonly retryDelay = 2000
  ) {
    super();
    this.setMaxListeners(100);
  }

    /**
   * Initialize all upstream connections from configuration
   */
  async initializeConnections(config: McpServersConfig): Promise<void> {
    const initStart = Date.now();
    const serverCount = Object.keys(config.mcpServers).length;
    console.log(`🔄 Initializing ${serverCount} upstream connections...`);

    const promises: Promise<{ name: string; duration: number; success: boolean; error?: string }>[] = [];

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      promises.push(this.addServerWithTiming(serverName, serverConfig));
    }

    // Wait for all connections to be attempted
    const results = await Promise.allSettled(promises);
    
    // Analyze results with timing
    let successCount = 0;
    let failureCount = 0;
    const timings: Array<{ name: string; duration: number; status: string }> = [];
    
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const serverResult = result.value;
        if (serverResult.success) {
          successCount++;
          console.log(`✅ ${serverResult.name} connected (${serverResult.duration}ms)`);
        } else {
          failureCount++;
          console.error(`❌ ${serverResult.name} failed (${serverResult.duration}ms): ${serverResult.error}`);
        }
        timings.push({
          name: serverResult.name,
          duration: serverResult.duration,
          status: serverResult.success ? 'success' : 'failed'
        });
      } else {
        failureCount++;
        console.error(`❌ Connection setup failed: ${result.reason}`);
      }
    });

    const totalDuration = Date.now() - initStart;
    const avgDuration = timings.length > 0 ? Math.round(timings.reduce((sum, t) => sum + t.duration, 0) / timings.length) : 0;
    
    console.log(`📊 Connection initialization complete (${totalDuration}ms): ${successCount} successful, ${failureCount} failed, avg: ${avgDuration}ms`);
    this.emit('initialized', { successCount, failureCount, totalDuration, avgDuration, timings });
  }

  /**
   * Update connections based on new configuration
   * This method handles adding new servers, removing old ones, and updating existing ones
   */
  async updateConnections(newConfig: McpServersConfig): Promise<void> {
    const updateStart = Date.now();
    console.log(`🔄 Updating upstream connections based on configuration changes...`);

    const newServerNames = new Set(Object.keys(newConfig.mcpServers));
    const currentServerNames = new Set(this.getServerNames());

    // Find servers to add, remove, and update
    const serversToAdd = Array.from(newServerNames).filter(name => !currentServerNames.has(name));
    const serversToRemove = Array.from(currentServerNames).filter(name => !newServerNames.has(name));
    const serversToUpdate = Array.from(newServerNames).filter(name => {
      if (!currentServerNames.has(name)) return false;
      
      const currentConfig = this.connections.get(name)?.config;
      const newServerConfig = newConfig.mcpServers[name];
      
      // Simple config comparison - in a real implementation you might want more sophisticated comparison
      return JSON.stringify(currentConfig) !== JSON.stringify(newServerConfig);
    });

    console.log(`📋 Configuration changes detected:`);
    console.log(`  ➕ Servers to add: ${serversToAdd.length}`);
    console.log(`  ➖ Servers to remove: ${serversToRemove.length}`);
    console.log(`  🔄 Servers to update: ${serversToUpdate.length}`);

    // Remove servers that are no longer in configuration
    for (const serverName of serversToRemove) {
      try {
        console.log(`🗑️  Removing server: ${serverName}`);
        await this.removeServer(serverName);
        console.log(`✅ Removed server: ${serverName}`);
      } catch (error) {
        console.error(`❌ Failed to remove server ${serverName}:`, error);
      }
    }

    // Update existing servers with new configuration
    for (const serverName of serversToUpdate) {
      try {
        console.log(`🔄 Updating server: ${serverName}`);
        await this.removeServer(serverName);
        await this.addServer(serverName, newConfig.mcpServers[serverName]);
        console.log(`✅ Updated server: ${serverName}`);
      } catch (error) {
        console.error(`❌ Failed to update server ${serverName}:`, error);
      }
    }

    // Add new servers
    const addPromises = serversToAdd.map(async (serverName) => {
      try {
        console.log(`➕ Adding new server: ${serverName}`);
        await this.addServer(serverName, newConfig.mcpServers[serverName]);
        console.log(`✅ Added server: ${serverName}`);
        return { name: serverName, success: true };
      } catch (error) {
        console.error(`❌ Failed to add server ${serverName}:`, error);
        return { name: serverName, success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    const addResults = await Promise.allSettled(addPromises);
    const successfulAdds = addResults.filter(result => 
      result.status === 'fulfilled' && result.value.success
    ).length;
    const failedAdds = addResults.length - successfulAdds;

    const totalDuration = Date.now() - updateStart;
    console.log(`📊 Configuration update complete (${totalDuration}ms):`);
    console.log(`  ✅ Removed: ${serversToRemove.length} servers`);
    console.log(`  ✅ Updated: ${serversToUpdate.length} servers`);
    console.log(`  ✅ Added: ${successfulAdds} servers`);
    console.log(`  ❌ Failed to add: ${failedAdds} servers`);

    this.emit('configurationUpdated', {
      added: serversToAdd.length,
      removed: serversToRemove.length,
      updated: serversToUpdate.length,
      failed: failedAdds,
      totalDuration
    });
  }

  /**
   * Add a new server connection with timing
   */
  private async addServerWithTiming(name: string, config: UpstreamServerConfig): Promise<{ name: string; duration: number; success: boolean; error?: string }> {
    const start = Date.now();
    try {
      await this.addServer(name, config);
      return {
        name,
        duration: Date.now() - start,
        success: true
      };
    } catch (error) {
      return {
        name,
        duration: Date.now() - start,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Add a new server connection
   */
  async addServer(name: string, config: UpstreamServerConfig): Promise<void> {
    if (this.connectors.has(name)) {
      throw new Error(`Server ${name} is already configured`);
    }

    try {
      // Create the appropriate connector
      const connector = this.createConnector(name, config);
      
      // Set up event handlers
      this.setupConnectorHandlers(name, connector);
      
      // Store the connector and connection info
      this.connectors.set(name, connector);
      this.connections.set(name, {
        name,
        config,
        status: 'disconnected',
        tools: [],
        resources: [],
        prompts: []
      });

      // Attempt connection
      await this.connectServer(name);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to add server ${name}: ${errorMessage}`);
      
      // Update connection status
      if (this.connections.has(name)) {
        const connection = this.connections.get(name)!;
        connection.status = 'error';
        connection.lastError = errorMessage;
        this.emit('serverStatusChanged', name, 'error', errorMessage);
      }
      
      throw error;
    }
  }

  /**
   * Remove a server connection
   */
  async removeServer(name: string): Promise<void> {
    const connector = this.connectors.get(name);
    if (!connector) {
      return;
    }

    try {
      // Clear reconnect timeout
      const timeout = this.reconnectTimeouts.get(name);
      if (timeout) {
        clearTimeout(timeout);
        this.reconnectTimeouts.delete(name);
      }

      // Disconnect the connector
      await connector.disconnect();
      
      // Remove from capability registry
      this.capabilityRegistry.clearServer(name);
      
      // Clean up
      this.connectors.delete(name);
      this.connections.delete(name);
      
      this.emit('serverRemoved', name);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error removing server ${name}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Connect to a specific server
   */
  async connectServer(name: string): Promise<void> {
    const connector = this.connectors.get(name);
    const connection = this.connections.get(name);
    
    if (!connector || !connection) {
      throw new Error(`Server ${name} not found`);
    }

    if (connector.isConnected()) {
      return;
    }

    try {
      // Update status
      this.updateConnectionStatus(name, 'connecting');
      
      // Attempt connection
      await connector.connect();
      
      // Discover capabilities
      await this.discoverServerCapabilities(name);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to connect to ${name}: ${errorMessage}`);
      
      this.updateConnectionStatus(name, 'error', errorMessage);
      
      // Schedule reconnection
      this.scheduleReconnection(name);
      
      throw error;
    }
  }

  /**
   * Disconnect from a specific server
   */
  async disconnectServer(name: string): Promise<void> {
    const connector = this.connectors.get(name);
    
    if (!connector) {
      throw new Error(`Server ${name} not found`);
    }

    try {
      console.log(`🔌 Disconnecting from server ${name}...`);
      
      // Clear reconnect timeout
      const timeout = this.reconnectTimeouts.get(name);
      if (timeout) {
        clearTimeout(timeout);
        this.reconnectTimeouts.delete(name);
      }
      
      await connector.disconnect();
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error disconnecting from ${name}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get a connector by name
   */
  getConnector(name: string): BaseConnector | undefined {
    return this.connectors.get(name);
  }

  /**
   * Get connection information for a server
   */
  getConnection(name: string): ServerConnection | undefined {
    return this.connections.get(name);
  }

  /**
   * Get all server names
   */
  getServerNames(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Get all connections
   */
  getAllConnections(): ServerConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connected servers
   */
  getConnectedServers(): string[] {
    return this.getServerNames().filter(name => {
      const connector = this.connectors.get(name);
      return connector?.isConnected();
    });
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    console.log(`🛑 Shutting down upstream manager...`);
    
    // Clear all reconnect timeouts
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();
    
    // Disconnect all servers
    const disconnectPromises: Promise<void>[] = [];
    
    for (const name of this.getServerNames()) {
      disconnectPromises.push(
        this.disconnectServer(name).catch(error => {
          console.error(`Error disconnecting ${name}:`, error);
        })
      );
    }
    
    await Promise.allSettled(disconnectPromises);
    
    // Clear capability registry
    this.capabilityRegistry.clear();
    
    // Remove all listeners
    this.removeAllListeners();
    
    console.log(`✅ Upstream manager shutdown complete`);
  }

  /**
   * Create the appropriate connector for a server configuration
   */
  private createConnector(name: string, config: UpstreamServerConfig): BaseConnector {
    const serverType = config.type || 'stdio';
    
    switch (serverType) {
      case 'stdio':
        return new StdioConnector(name, config as import('./types.js').StdioServerConfig);
      case 'sse':
        // Use AutoConnector for better compatibility with legacy SSE servers
        return new AutoConnector(name, config as import('./types.js').SseServerConfig);
      case 'streamable-http':
        // Directly use StreamableHttpConnector for streamable-http servers
        return new StreamableHttpConnector(name, config as import('./types.js').StreamableHttpServerConfig);
      default:
        // For URLs without explicit type, use AutoConnector for detection
        if ((config as any).url) {
          // Special handling for known streamable-http servers
          if (name === 'streamable-mcp-server') {
            return new StreamableHttpConnector(name, config as import('./types.js').StreamableHttpServerConfig);
          }
          return new AutoConnector(name, config);
        }
        throw new Error(`Unsupported server type: ${serverType}`);
    }
  }

  /**
   * Set up event handlers for a connector
   */
  private setupConnectorHandlers(name: string, connector: BaseConnector): void {
    connector.on('connected', () => {
      this.updateConnectionStatus(name, 'connected');
      this.discoverServerCapabilities(name).catch(error => {
        console.error(`❌ Failed to discover capabilities for ${name}:`, error);
      });
    });

    connector.on('disconnected', () => {
      this.updateConnectionStatus(name, 'disconnected');
      
      // Clear capabilities from registry
      this.capabilityRegistry.clearServer(name);
      
      // Schedule reconnection
      this.scheduleReconnection(name);
    });

    connector.on('error', (error: Error) => {
      this.updateConnectionStatus(name, 'error', error.message);
      
      // Clear capabilities from registry
      this.capabilityRegistry.clearServer(name);
      
      // Schedule reconnection
      this.scheduleReconnection(name);
    });

    connector.on('notification', (notification) => {
      this.emit('notification', name, notification);
    });
  }

  /**
   * Update connection status
   */
  private updateConnectionStatus(name: string, status: ServerStatus, error?: string): void {
    const connection = this.connections.get(name);
    if (!connection) {
      return;
    }

    connection.status = status;
    connection.lastError = error;
    
    if (status === 'connected') {
      connection.connectedAt = new Date();
    }

    this.emit('serverStatusChanged', name, status, error);
  }

  /**
   * Discover capabilities for a server
   */
  private async discoverServerCapabilities(name: string): Promise<void> {
    const connector = this.connectors.get(name);
    const connection = this.connections.get(name);
    
    if (!connector || !connection) {
      return;
    }

    try {
      console.log(`🔍 Discovering capabilities for ${name}...`);
      
      const { tools, resources, prompts } = await connector.discoverCapabilities();
      
      // Update connection info
      connection.tools = tools;
      connection.resources = resources;
      
      // Register capabilities
      this.capabilityRegistry.registerTools(name, tools);
      this.capabilityRegistry.registerResources(name, resources);
      this.capabilityRegistry.registerPrompts(name, prompts);
      
      console.log(`✅ Registered ${tools.length} tools, ${resources.length} resources, and ${prompts.length} prompts for ${name}`);
      this.emit('capabilitiesDiscovered', name, { tools, resources, prompts });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to discover capabilities for ${name}: ${errorMessage}`);
      
      // Don't disconnect on capability discovery failure, but log the error
      connection.lastError = `Capability discovery failed: ${errorMessage}`;
      this.emit('capabilityDiscoveryFailed', name, errorMessage);
    }
  }

  // Method removed - capability discovery is handled in discoverCapabilities method

  /**
   * Schedule reconnection for a server
   */
  private scheduleReconnection(name: string): void {
    // Don't schedule if already scheduled
    if (this.reconnectTimeouts.has(name)) {
      return;
    }

    console.log(`⏱️  Scheduling reconnection for ${name} in ${this.retryDelay}ms`);
    
    const timeout = setTimeout(async () => {
      this.reconnectTimeouts.delete(name);
      
      // Check if server still exists before attempting to reconnect
      if (!this.connectors.has(name) || !this.connections.has(name)) {
        console.log(`ℹ️  Server ${name} was removed from configuration, skipping reconnection`);
        return;
      }
      
      try {
        await this.connectServer(name);
      } catch (error) {
        console.error(`❌ Reconnection failed for ${name}:`, error);
      }
    }, this.retryDelay);
    
    this.reconnectTimeouts.set(name, timeout);
  }

  /**
   * Route a message to a specific upstream server
   */
  async routeMessage(serverName: string, message: any): Promise<any> {
    const connector = this.connectors.get(serverName);
    if (!connector) {
      throw new Error(`Server ${serverName} not found`);
    }

    if (!connector.isConnected()) {
      throw new Error(`Server ${serverName} is not connected`);
    }

    return await connector.sendMessage(message);
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const connectedServers: Array<{
      name: string;
      toolCount: number;
      resourceCount: number;
      promptCount: number;
    }> = [];

    let totalTools = 0;
    let totalResources = 0;
    let totalPrompts = 0;

    for (const [name, connection] of this.connections) {
      if (connection.status === 'connected') {
        const toolCount = connection.tools?.length || 0;
        const resourceCount = connection.resources?.length || 0;
        const promptCount = connection.prompts?.length || 0;
        connectedServers.push({
          name,
          toolCount,
          resourceCount,
          promptCount
        });
        
        totalTools += toolCount;
        totalResources += resourceCount;
        totalPrompts += promptCount;
      }
    }

    return {
      connectedServers,
      totalTools,
      totalResources,
      totalPrompts
    };
  }
} 