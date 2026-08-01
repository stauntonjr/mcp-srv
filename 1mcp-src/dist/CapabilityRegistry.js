/**
 * Capability Registry for 1mcp
 * Manages registration and lookup of tools and resources from upstream servers
 */
/**
 * Utility functions for handling prefixed names
 */
export class PrefixUtility {
    static SEPARATOR = '___';
    get SEPARATOR() {
        return PrefixUtility.SEPARATOR;
    }
    /**
     * Add server name prefix to a capability name
     */
    addPrefix(serverName, name) {
        return `${serverName}${PrefixUtility.SEPARATOR}${name}`;
    }
    /**
     * Remove server name prefix from a capability name
     */
    removePrefix(prefixedName) {
        const separatorIndex = prefixedName.indexOf(PrefixUtility.SEPARATOR);
        if (separatorIndex === -1) {
            return null;
        }
        const serverName = prefixedName.substring(0, separatorIndex);
        const originalName = prefixedName.substring(separatorIndex + PrefixUtility.SEPARATOR.length);
        if (!serverName || !originalName) {
            return null;
        }
        return { serverName, originalName };
    }
}
/**
 * Registry for managing tools from upstream servers
 */
export class ToolRegistry {
    tools = new Map();
    serverTools = new Map();
    prefixUtils = new PrefixUtility();
    /**
     * Register tools from a server
     */
    registerTools(serverName, tools) {
        // Clear existing tools for this server
        this.clearServerTools(serverName);
        const registeredNames = new Set();
        for (const tool of tools) {
            const prefixedName = this.prefixUtils.addPrefix(serverName, tool.name);
            // Check for name conflicts
            if (this.tools.has(prefixedName)) {
                console.warn(`⚠️  Tool name conflict: ${prefixedName} (skipping duplicate)`);
                continue;
            }
            const registeredTool = {
                ...tool,
                serverName,
                originalName: tool.name,
                prefixedName
            };
            this.tools.set(prefixedName, registeredTool);
            registeredNames.add(prefixedName);
        }
        this.serverTools.set(serverName, registeredNames);
        console.log(`📝 Registered ${registeredNames.size} tools for server ${serverName}`);
    }
    /**
     * Get a tool by its prefixed name
     */
    getTool(prefixedName) {
        return this.tools.get(prefixedName);
    }
    /**
     * Get all registered tools
     */
    getAllTools() {
        return Array.from(this.tools.values());
    }
    /**
     * Get tools for a specific server
     */
    getServerTools(serverName) {
        const toolNames = this.serverTools.get(serverName);
        if (!toolNames) {
            return [];
        }
        const tools = [];
        for (const toolName of toolNames) {
            const tool = this.tools.get(toolName);
            if (tool) {
                tools.push(tool);
            }
        }
        return tools;
    }
    /**
     * Get all server names that have registered tools
     */
    getServerNames() {
        return Array.from(this.serverTools.keys());
    }
    /**
     * Check if a tool exists
     */
    hasTool(prefixedName) {
        return this.tools.has(prefixedName);
    }
    /**
     * Get tool count for a server
     */
    getServerToolCount(serverName) {
        const toolNames = this.serverTools.get(serverName);
        return toolNames ? toolNames.size : 0;
    }
    /**
     * Get total tool count
     */
    getTotalToolCount() {
        return this.tools.size;
    }
    /**
     * Clear tools for a specific server
     */
    clearServerTools(serverName) {
        const toolNames = this.serverTools.get(serverName);
        if (toolNames) {
            for (const toolName of toolNames) {
                this.tools.delete(toolName);
            }
            this.serverTools.delete(serverName);
        }
    }
    /**
     * Clear all tools
     */
    clear() {
        this.tools.clear();
        this.serverTools.clear();
    }
    /**
     * Search tools by name pattern
     */
    searchTools(pattern) {
        const regex = new RegExp(pattern, 'i');
        return this.getAllTools().filter(tool => regex.test(tool.name) || regex.test(tool.description) || regex.test(tool.prefixedName));
    }
}
/**
 * Registry for managing resources from upstream servers
 */
export class ResourceRegistry {
    resources = new Map();
    serverResources = new Map();
    prefixUtils = new PrefixUtility();
    /**
     * Register resources from a server
     */
    registerResources(serverName, resources) {
        // Clear existing resources for this server
        this.clearServerResources(serverName);
        const registeredUris = new Set();
        for (const resource of resources) {
            const prefixedUri = this.prefixUtils.addPrefix(serverName, resource.uri);
            // Check for URI conflicts
            if (this.resources.has(prefixedUri)) {
                console.warn(`⚠️  Resource URI conflict: ${prefixedUri} (skipping duplicate)`);
                continue;
            }
            const registeredResource = {
                ...resource,
                serverName,
                originalUri: resource.uri,
                prefixedUri
            };
            this.resources.set(prefixedUri, registeredResource);
            registeredUris.add(prefixedUri);
        }
        this.serverResources.set(serverName, registeredUris);
        console.log(`📚 Registered ${registeredUris.size} resources for server ${serverName}`);
    }
    /**
     * Get a resource by its prefixed URI
     */
    getResource(prefixedUri) {
        return this.resources.get(prefixedUri);
    }
    /**
     * Get all registered resources
     */
    getAllResources() {
        return Array.from(this.resources.values());
    }
    /**
     * Get resources for a specific server
     */
    getServerResources(serverName) {
        const resourceUris = this.serverResources.get(serverName);
        if (!resourceUris) {
            return [];
        }
        const resources = [];
        for (const resourceUri of resourceUris) {
            const resource = this.resources.get(resourceUri);
            if (resource) {
                resources.push(resource);
            }
        }
        return resources;
    }
    /**
     * Get all server names that have registered resources
     */
    getServerNames() {
        return Array.from(this.serverResources.keys());
    }
    /**
     * Check if a resource exists
     */
    hasResource(prefixedUri) {
        return this.resources.has(prefixedUri);
    }
    /**
     * Get resource count for a server
     */
    getServerResourceCount(serverName) {
        const resourceUris = this.serverResources.get(serverName);
        return resourceUris ? resourceUris.size : 0;
    }
    /**
     * Get total resource count
     */
    getTotalResourceCount() {
        return this.resources.size;
    }
    /**
     * Clear resources for a specific server
     */
    clearServerResources(serverName) {
        const resourceUris = this.serverResources.get(serverName);
        if (resourceUris) {
            for (const resourceUri of resourceUris) {
                this.resources.delete(resourceUri);
            }
            this.serverResources.delete(serverName);
        }
    }
    /**
     * Clear all resources
     */
    clear() {
        this.resources.clear();
        this.serverResources.clear();
    }
    /**
     * Search resources by name or URI pattern
     */
    searchResources(pattern) {
        const regex = new RegExp(pattern, 'i');
        return this.getAllResources().filter(resource => regex.test(resource.name) ||
            regex.test(resource.uri) ||
            regex.test(resource.prefixedUri) ||
            (resource.description && regex.test(resource.description)));
    }
}
/**
 * Registry for managing prompts from upstream servers
 */
export class PromptRegistry {
    prompts = new Map();
    serverPrompts = new Map();
    prefixUtils = new PrefixUtility();
    /**
     * Register prompts from a server
     */
    registerPrompts(serverName, prompts) {
        // Clear existing prompts for this server
        this.clearServerPrompts(serverName);
        const registeredNames = new Set();
        for (const prompt of prompts) {
            const prefixedName = this.prefixUtils.addPrefix(serverName, prompt.name);
            // Check for name conflicts
            if (this.prompts.has(prefixedName)) {
                console.warn(`⚠️  Prompt name conflict: ${prefixedName} (skipping duplicate)`);
                continue;
            }
            const registeredPrompt = {
                ...prompt,
                serverName,
                originalName: prompt.name,
                prefixedName
            };
            this.prompts.set(prefixedName, registeredPrompt);
            registeredNames.add(prefixedName);
        }
        this.serverPrompts.set(serverName, registeredNames);
        console.log(`💬 Registered ${registeredNames.size} prompts for server ${serverName}`);
    }
    /**
     * Clear prompts for a specific server
     */
    clearServerPrompts(serverName) {
        const existingPrompts = this.serverPrompts.get(serverName);
        if (existingPrompts) {
            for (const prefixedName of existingPrompts) {
                this.prompts.delete(prefixedName);
            }
            this.serverPrompts.delete(serverName);
        }
    }
    /**
     * Get a specific prompt by prefixed name
     */
    getPrompt(prefixedName) {
        return this.prompts.get(prefixedName);
    }
    /**
     * Get all registered prompts
     */
    getAllPrompts() {
        return Array.from(this.prompts.values());
    }
    /**
     * Get prompts for a specific server
     */
    getServerPrompts(serverName) {
        const promptNames = this.serverPrompts.get(serverName);
        if (!promptNames)
            return [];
        return Array.from(promptNames)
            .map(name => this.prompts.get(name))
            .filter((prompt) => prompt !== undefined);
    }
    /**
     * Get server names that have prompts
     */
    getServerNames() {
        return Array.from(this.serverPrompts.keys());
    }
    /**
     * Search prompts by pattern
     */
    searchPrompts(pattern) {
        const lowerPattern = pattern.toLowerCase();
        return this.getAllPrompts().filter(prompt => prompt.name.toLowerCase().includes(lowerPattern) ||
            prompt.description?.toLowerCase().includes(lowerPattern));
    }
    /**
     * Get total number of prompts
     */
    getTotalPrompts() {
        return this.prompts.size;
    }
    /**
     * Clear all prompts
     */
    clear() {
        this.prompts.clear();
        this.serverPrompts.clear();
    }
}
/**
 * Main capability registry that manages all types of capabilities
 */
export class CapabilityRegistry {
    toolRegistry;
    resourceRegistry;
    promptRegistry;
    constructor() {
        this.toolRegistry = new ToolRegistry();
        this.resourceRegistry = new ResourceRegistry();
        this.promptRegistry = new PromptRegistry();
    }
    /**
     * Register tools from a server
     */
    registerTools(serverName, tools) {
        this.toolRegistry.registerTools(serverName, tools);
    }
    /**
     * Register resources from a server
     */
    registerResources(serverName, resources) {
        this.resourceRegistry.registerResources(serverName, resources);
    }
    /**
     * Register prompts from a server
     */
    registerPrompts(serverName, prompts) {
        this.promptRegistry.registerPrompts(serverName, prompts);
    }
    /**
     * Get a tool by its prefixed name
     */
    getTool(prefixedName) {
        return this.toolRegistry.getTool(prefixedName);
    }
    /**
     * Get a resource by its prefixed URI
     */
    getResource(prefixedUri) {
        return this.resourceRegistry.getResource(prefixedUri);
    }
    /**
     * Get a specific prompt by prefixed name
     */
    getPrompt(prefixedName) {
        return this.promptRegistry.getPrompt(prefixedName);
    }
    /**
     * Get all registered tools
     */
    getAllTools() {
        return this.toolRegistry.getAllTools();
    }
    /**
     * Get all registered resources
     */
    getAllResources() {
        return this.resourceRegistry.getAllResources();
    }
    /**
     * Get all registered prompts
     */
    getAllPrompts() {
        return this.promptRegistry.getAllPrompts();
    }
    /**
     * Clear capabilities for a specific server
     */
    clearServer(serverName) {
        this.toolRegistry.clearServerTools(serverName);
        this.resourceRegistry.clearServerResources(serverName);
        this.promptRegistry.clearServerPrompts(serverName);
        console.log(`🧹 Cleared capabilities for server ${serverName}`);
    }
    /**
     * Clear all capabilities
     */
    clear() {
        this.toolRegistry.clear();
        this.resourceRegistry.clear();
        this.promptRegistry.clear();
        console.log(`🧹 Cleared all capabilities`);
    }
    /**
     * Get summary of all capabilities
     */
    getSummary() {
        const toolServerNames = this.toolRegistry.getServerNames();
        const resourceServerNames = this.resourceRegistry.getServerNames();
        const promptServerNames = this.promptRegistry.getServerNames();
        const allServerNames = new Set([...toolServerNames, ...resourceServerNames, ...promptServerNames]);
        return {
            totalTools: this.toolRegistry.getTotalToolCount(),
            totalResources: this.resourceRegistry.getTotalResourceCount(),
            totalPrompts: this.promptRegistry.getTotalPrompts(),
            serverCount: allServerNames.size
        };
    }
    /**
     * Search capabilities by pattern
     */
    search(pattern) {
        return {
            tools: this.toolRegistry.searchTools(pattern),
            resources: this.resourceRegistry.searchResources(pattern),
            prompts: this.promptRegistry.searchPrompts(pattern) // Assuming searchPrompts is added to PromptRegistry
        };
    }
    /**
     * Get tool registry (for internal use)
     */
    getToolRegistry() {
        return this.toolRegistry;
    }
    /**
     * Get resource registry (for internal use)
     */
    getResourceRegistry() {
        return this.resourceRegistry;
    }
    /**
     * Get prompt registry (for internal use)
     */
    getPromptRegistry() {
        return this.promptRegistry;
    }
}
//# sourceMappingURL=CapabilityRegistry.js.map