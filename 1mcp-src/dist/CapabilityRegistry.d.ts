/**
 * Capability Registry for 1mcp
 * Manages registration and lookup of tools and resources from upstream servers
 */
import { CapabilityRegistry as ICapabilityRegistry, MCPTool, MCPResource, RegisteredTool, RegisteredResource, PrefixUtils, MCPPrompt, RegisteredPrompt, CapabilitySummary } from './types.js';
/**
 * Utility functions for handling prefixed names
 */
export declare class PrefixUtility implements PrefixUtils {
    static readonly SEPARATOR = "___";
    get SEPARATOR(): string;
    /**
     * Add server name prefix to a capability name
     */
    addPrefix(serverName: string, name: string): string;
    /**
     * Remove server name prefix from a capability name
     */
    removePrefix(prefixedName: string): {
        serverName: string;
        originalName: string;
    } | null;
}
/**
 * Registry for managing tools from upstream servers
 */
export declare class ToolRegistry {
    private tools;
    private serverTools;
    private prefixUtils;
    /**
     * Register tools from a server
     */
    registerTools(serverName: string, tools: MCPTool[]): void;
    /**
     * Get a tool by its prefixed name
     */
    getTool(prefixedName: string): RegisteredTool | undefined;
    /**
     * Get all registered tools
     */
    getAllTools(): RegisteredTool[];
    /**
     * Get tools for a specific server
     */
    getServerTools(serverName: string): RegisteredTool[];
    /**
     * Get all server names that have registered tools
     */
    getServerNames(): string[];
    /**
     * Check if a tool exists
     */
    hasTool(prefixedName: string): boolean;
    /**
     * Get tool count for a server
     */
    getServerToolCount(serverName: string): number;
    /**
     * Get total tool count
     */
    getTotalToolCount(): number;
    /**
     * Clear tools for a specific server
     */
    clearServerTools(serverName: string): void;
    /**
     * Clear all tools
     */
    clear(): void;
    /**
     * Search tools by name pattern
     */
    searchTools(pattern: string): RegisteredTool[];
}
/**
 * Registry for managing resources from upstream servers
 */
export declare class ResourceRegistry {
    private resources;
    private serverResources;
    private prefixUtils;
    /**
     * Register resources from a server
     */
    registerResources(serverName: string, resources: MCPResource[]): void;
    /**
     * Get a resource by its prefixed URI
     */
    getResource(prefixedUri: string): RegisteredResource | undefined;
    /**
     * Get all registered resources
     */
    getAllResources(): RegisteredResource[];
    /**
     * Get resources for a specific server
     */
    getServerResources(serverName: string): RegisteredResource[];
    /**
     * Get all server names that have registered resources
     */
    getServerNames(): string[];
    /**
     * Check if a resource exists
     */
    hasResource(prefixedUri: string): boolean;
    /**
     * Get resource count for a server
     */
    getServerResourceCount(serverName: string): number;
    /**
     * Get total resource count
     */
    getTotalResourceCount(): number;
    /**
     * Clear resources for a specific server
     */
    clearServerResources(serverName: string): void;
    /**
     * Clear all resources
     */
    clear(): void;
    /**
     * Search resources by name or URI pattern
     */
    searchResources(pattern: string): RegisteredResource[];
}
/**
 * Registry for managing prompts from upstream servers
 */
export declare class PromptRegistry {
    private prompts;
    private serverPrompts;
    private prefixUtils;
    /**
     * Register prompts from a server
     */
    registerPrompts(serverName: string, prompts: MCPPrompt[]): void;
    /**
     * Clear prompts for a specific server
     */
    clearServerPrompts(serverName: string): void;
    /**
     * Get a specific prompt by prefixed name
     */
    getPrompt(prefixedName: string): RegisteredPrompt | undefined;
    /**
     * Get all registered prompts
     */
    getAllPrompts(): RegisteredPrompt[];
    /**
     * Get prompts for a specific server
     */
    getServerPrompts(serverName: string): RegisteredPrompt[];
    /**
     * Get server names that have prompts
     */
    getServerNames(): string[];
    /**
     * Search prompts by pattern
     */
    searchPrompts(pattern: string): RegisteredPrompt[];
    /**
     * Get total number of prompts
     */
    getTotalPrompts(): number;
    /**
     * Clear all prompts
     */
    clear(): void;
}
/**
 * Main capability registry that manages all types of capabilities
 */
export declare class CapabilityRegistry implements ICapabilityRegistry {
    private toolRegistry;
    private resourceRegistry;
    private promptRegistry;
    constructor();
    /**
     * Register tools from a server
     */
    registerTools(serverName: string, tools: MCPTool[]): void;
    /**
     * Register resources from a server
     */
    registerResources(serverName: string, resources: MCPResource[]): void;
    /**
     * Register prompts from a server
     */
    registerPrompts(serverName: string, prompts: MCPPrompt[]): void;
    /**
     * Get a tool by its prefixed name
     */
    getTool(prefixedName: string): RegisteredTool | undefined;
    /**
     * Get a resource by its prefixed URI
     */
    getResource(prefixedUri: string): RegisteredResource | undefined;
    /**
     * Get a specific prompt by prefixed name
     */
    getPrompt(prefixedName: string): RegisteredPrompt | undefined;
    /**
     * Get all registered tools
     */
    getAllTools(): RegisteredTool[];
    /**
     * Get all registered resources
     */
    getAllResources(): RegisteredResource[];
    /**
     * Get all registered prompts
     */
    getAllPrompts(): RegisteredPrompt[];
    /**
     * Clear capabilities for a specific server
     */
    clearServer(serverName: string): void;
    /**
     * Clear all capabilities
     */
    clear(): void;
    /**
     * Get summary of all capabilities
     */
    getSummary(): CapabilitySummary;
    /**
     * Search capabilities by pattern
     */
    search(pattern: string): {
        tools: RegisteredTool[];
        resources: RegisteredResource[];
        prompts: RegisteredPrompt[];
    };
    /**
     * Get tool registry (for internal use)
     */
    getToolRegistry(): ToolRegistry;
    /**
     * Get resource registry (for internal use)
     */
    getResourceRegistry(): ResourceRegistry;
    /**
     * Get prompt registry (for internal use)
     */
    getPromptRegistry(): PromptRegistry;
}
