/**
 * Configuration loader for 1mcp
 * Reads and validates mcpServers.json configuration files
 */
import { McpServersConfig, UpstreamServerConfig } from './types.js';
export declare class ConfigLoader {
    private static readonly DEFAULT_CONFIG_PATHS;
    private static configWatchers;
    /**
     * Load configuration from the specified file or default locations
     */
    static load(configPath?: string): Promise<McpServersConfig>;
    /**
     * Start watching a configuration file for changes
     */
    static startWatching(configPath: string, callback: (config: McpServersConfig) => void): Promise<void>;
    /**
     * Stop watching a configuration file
     */
    static stopWatching(configPath: string): void;
    /**
     * Stop all configuration file watchers
     */
    static stopAllWatchers(): void;
    /**
     * Get the list of currently watched configuration files
     */
    static getWatchedFiles(): string[];
    /**
     * Validate the configuration structure and server definitions
     */
    private static validateConfig;
    /**
     * Validate server name
     */
    private static validateServerName;
    /**
     * Validate individual server configuration
     */
    private static validateServerConfig;
    /**
     * Validate stdio server configuration
     */
    private static validateStdioConfig;
    /**
     * Validate SSE server configuration
     */
    private static validateSseConfig;
    /**
     * Validate streamable-http server configuration
     */
    private static validateStreamableHttpConfig;
    /**
     * Get list of configured server names
     */
    static getServerNames(config: McpServersConfig): string[];
    /**
     * Get configuration for a specific server
     */
    static getServerConfig(config: McpServersConfig, serverName: string): UpstreamServerConfig | undefined;
    /**
     * Create a default configuration file
     */
    static createDefaultConfig(outputPath?: string): Promise<void>;
}
