/**
 * Configuration loader for 1mcp
 * Reads and validates mcpServers.json configuration files
 */
import { watch } from 'fs';
import fs from 'fs/promises';
import path from 'path';
export class ConfigLoader {
    static DEFAULT_CONFIG_PATHS = [
        'config/mcp_servers.json',
        'mcp_servers.json',
        './mcp_servers.json'
    ];
    static configWatchers = new Map();
    /**
     * Load configuration from the specified file or default locations
     */
    static async load(configPath) {
        const loadStart = Date.now();
        const pathsToTry = configPath ? [configPath] : this.DEFAULT_CONFIG_PATHS;
        for (const filePath of pathsToTry) {
            try {
                const resolvedPath = path.resolve(filePath);
                // Parallel read and parse
                const [content] = await Promise.all([
                    fs.readFile(resolvedPath, 'utf-8')
                ]);
                const config = JSON.parse(content);
                // Validate the configuration
                this.validateConfig(config);
                const loadTime = Date.now() - loadStart;
                console.log(`✅ Configuration loaded from: ${resolvedPath} (${loadTime}ms)`);
                return config;
            }
            catch (error) {
                if (configPath) {
                    // If a specific path was provided, throw the error
                    throw new Error(`Failed to load configuration from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
                // If trying default paths, continue to the next one
                continue;
            }
        }
        throw new Error(`No valid configuration file found. Tried: ${pathsToTry.join(', ')}`);
    }
    /**
     * Start watching a configuration file for changes
     */
    static async startWatching(configPath, callback) {
        const resolvedPath = path.resolve(configPath);
        // Stop existing watcher if any
        this.stopWatching(configPath);
        try {
            // Verify the file exists and is readable
            await fs.access(resolvedPath);
            // Get initial file stats
            const stats = await fs.stat(resolvedPath);
            // Create file watcher
            const watcher = watch(resolvedPath, { persistent: true }, async (eventType, filename) => {
                if (eventType === 'change') {
                    try {
                        // Add a small delay to ensure file write is complete
                        await new Promise(resolve => setTimeout(resolve, 100));
                        // Check if file was actually modified
                        const newStats = await fs.stat(resolvedPath);
                        const watcherInfo = this.configWatchers.get(configPath);
                        if (watcherInfo && newStats.mtime.getTime() > watcherInfo.lastModified) {
                            console.log(`📝 Configuration file changed: ${resolvedPath}`);
                            // Load and validate new configuration
                            const newConfig = await this.load(configPath);
                            // Update last modified time
                            watcherInfo.lastModified = newStats.mtime.getTime();
                            // Call the callback with new configuration
                            callback(newConfig);
                        }
                    }
                    catch (error) {
                        console.error(`❌ Failed to reload configuration from ${resolvedPath}:`, error);
                    }
                }
            });
            // Store watcher information
            this.configWatchers.set(configPath, {
                watcher,
                lastModified: stats.mtime.getTime(),
                callback
            });
            console.log(`👀 Started watching configuration file: ${resolvedPath}`);
        }
        catch (error) {
            throw new Error(`Failed to start watching configuration file ${resolvedPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Stop watching a configuration file
     */
    static stopWatching(configPath) {
        const watcherInfo = this.configWatchers.get(configPath);
        if (watcherInfo) {
            watcherInfo.watcher.close();
            this.configWatchers.delete(configPath);
            console.log(`🛑 Stopped watching configuration file: ${configPath}`);
        }
    }
    /**
     * Stop all configuration file watchers
     */
    static stopAllWatchers() {
        for (const [configPath] of this.configWatchers) {
            this.stopWatching(configPath);
        }
    }
    /**
     * Get the list of currently watched configuration files
     */
    static getWatchedFiles() {
        return Array.from(this.configWatchers.keys());
    }
    /**
     * Validate the configuration structure and server definitions
     */
    static validateConfig(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('Configuration must be an object');
        }
        if (!config.mcpServers || typeof config.mcpServers !== 'object') {
            throw new Error('Configuration must contain a "mcpServers" object');
        }
        const servers = config.mcpServers;
        const serverNames = Object.keys(servers);
        if (serverNames.length === 0) {
            throw new Error('At least one server must be configured in mcpServers');
        }
        // Validate each server configuration
        for (const [serverName, serverConfig] of Object.entries(servers)) {
            this.validateServerName(serverName);
            this.validateServerConfig(serverName, serverConfig);
        }
        console.log(`✅ Configuration validated: ${serverNames.length} servers configured`);
    }
    /**
     * Validate server name
     */
    static validateServerName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Server name must be a non-empty string');
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            throw new Error(`Invalid server name "${name}". Server names must contain only letters, numbers, underscores, and hyphens`);
        }
        if (name.includes('___')) {
            throw new Error(`Invalid server name "${name}". Server names cannot contain triple underscores (___) as they are used as separators`);
        }
    }
    /**
     * Validate individual server configuration
     */
    static validateServerConfig(serverName, config) {
        if (!config || typeof config !== 'object') {
            throw new Error(`Server "${serverName}" configuration must be an object`);
        }
        const serverType = config.type || 'stdio';
        switch (serverType) {
            case 'stdio':
                this.validateStdioConfig(serverName, config);
                break;
            case 'sse':
                this.validateSseConfig(serverName, config);
                break;
            case 'streamable-http':
                this.validateStreamableHttpConfig(serverName, config);
                break;
            default:
                throw new Error(`Server "${serverName}" has invalid type "${serverType}". Must be "stdio", "sse", or "streamable-http"`);
        }
    }
    /**
     * Validate stdio server configuration
     */
    static validateStdioConfig(serverName, config) {
        if (!config.command || typeof config.command !== 'string') {
            throw new Error(`Server "${serverName}" (stdio) must have a valid "command" string`);
        }
        if (config.args && !Array.isArray(config.args)) {
            throw new Error(`Server "${serverName}" (stdio) "args" must be an array if provided`);
        }
        if (config.args) {
            for (const arg of config.args) {
                if (typeof arg !== 'string') {
                    throw new Error(`Server "${serverName}" (stdio) all arguments must be strings`);
                }
            }
        }
        if (config.env && typeof config.env !== 'object') {
            throw new Error(`Server "${serverName}" (stdio) "env" must be an object if provided`);
        }
        if (config.env) {
            for (const [key, value] of Object.entries(config.env)) {
                if (typeof key !== 'string' || typeof value !== 'string') {
                    throw new Error(`Server "${serverName}" (stdio) environment variables must be string key-value pairs`);
                }
            }
        }
    }
    /**
     * Validate SSE server configuration
     */
    static validateSseConfig(serverName, config) {
        if (!config.url || typeof config.url !== 'string') {
            throw new Error(`Server "${serverName}" (sse) must have a valid "url" string`);
        }
        try {
            new URL(config.url);
        }
        catch {
            throw new Error(`Server "${serverName}" (sse) "url" must be a valid URL`);
        }
        if (config.headers && typeof config.headers !== 'object') {
            throw new Error(`Server "${serverName}" (sse) "headers" must be an object if provided`);
        }
        if (config.headers) {
            for (const [key, value] of Object.entries(config.headers)) {
                if (typeof key !== 'string' || typeof value !== 'string') {
                    throw new Error(`Server "${serverName}" (sse) headers must be string key-value pairs`);
                }
            }
        }
    }
    /**
     * Validate streamable-http server configuration
     */
    static validateStreamableHttpConfig(serverName, config) {
        if (!config.url || typeof config.url !== 'string') {
            throw new Error(`Server "${serverName}" (streamable-http) must have a valid "url" string`);
        }
        try {
            new URL(config.url);
        }
        catch {
            throw new Error(`Server "${serverName}" (streamable-http) "url" must be a valid URL`);
        }
        if (config.headers && typeof config.headers !== 'object') {
            throw new Error(`Server "${serverName}" (streamable-http) "headers" must be an object if provided`);
        }
        if (config.headers) {
            for (const [key, value] of Object.entries(config.headers)) {
                if (typeof key !== 'string' || typeof value !== 'string') {
                    throw new Error(`Server "${serverName}" (streamable-http) headers must be string key-value pairs`);
                }
            }
        }
    }
    /**
     * Get list of configured server names
     */
    static getServerNames(config) {
        return Object.keys(config.mcpServers);
    }
    /**
     * Get configuration for a specific server
     */
    static getServerConfig(config, serverName) {
        return config.mcpServers[serverName];
    }
    /**
     * Create a default configuration file
     */
    static async createDefaultConfig(outputPath = 'config/mcp_servers.json') {
        const defaultConfig = {
            mcpServers: {
                "example-stdio": {
                    command: "echo",
                    args: ["Hello from stdio server"]
                },
                "example-sse": {
                    type: "sse",
                    url: "http://localhost:8080/mcp/sse"
                },
                "example-http": {
                    type: "streamable-http",
                    url: "http://localhost:8080/mcp"
                }
            }
        };
        // Ensure directory exists
        const dir = path.dirname(outputPath);
        await fs.mkdir(dir, { recursive: true });
        // Write configuration file
        await fs.writeFile(outputPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
        console.log(`✅ Default configuration created at: ${path.resolve(outputPath)}`);
    }
}
//# sourceMappingURL=ConfigLoader.js.map