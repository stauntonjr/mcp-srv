/**
 * Core type definitions for 1mcp
 */

// =============================================================================
// Upstream Server Configuration Types
// =============================================================================

/**
 * Configuration for stdio-based upstream server
 */
export interface StdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Configuration for SSE-based upstream server
 */
export interface SseServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Configuration for streamable-http-based upstream server
 */
export interface StreamableHttpServerConfig {
  type: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Union type for all upstream server configurations
 */
export type UpstreamServerConfig = StdioServerConfig | SseServerConfig | StreamableHttpServerConfig;

/**
 * Configuration file structure for mcp_servers.json
 */
export interface McpServersConfig {
  mcpServers: Record<string, UpstreamServerConfig>;
  // hubConfig removed - now using command line arguments
}

// =============================================================================
// MCP Standard Types
// =============================================================================

/**
 * MCP Tool parameter definition
 */
export interface MCPToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: any;
  enum?: any[];
  properties?: Record<string, MCPToolParameter>;
  items?: MCPToolParameter;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  title?: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP Prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * MCP Message types
 */
export type MCPMessageType = 
  | 'initialize'
  | 'tools/list'
  | 'resources/list'
  | 'tools/call'
  | 'resources/read'
  | 'prompts/list'
  | 'prompts/get'
  | 'ping'
  | 'error'
  // Notification types
  | 'notifications/initialized'
  | 'notifications/cancelled'
  | 'tools/list_changed'
  | 'resources/list_changed';

/**
 * Base MCP Message structure
 */
export interface MCPMessageBase {
  jsonrpc: '2.0';
  id?: string | number;
  method: MCPMessageType;
  params?: any;
}

/**
 * MCP Request message
 */
export interface MCPRequest extends MCPMessageBase {
  id: string | number;
}

/**
 * MCP Response message
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * MCP Notification message (no response expected)
 */
export interface MCPNotification extends MCPMessageBase {
  id?: never;
}

/**
 * Union type for all MCP messages
 */
export type MCPMessage = MCPRequest | MCPResponse | MCPNotification;

/**
 * MCP Tool call parameters
 */
export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

/**
 * MCP Tool call result
 */
export interface MCPToolResult {
  content?: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Resource content
 */
export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

// =============================================================================
// Extended Types for 1mcp
// =============================================================================

/**
 * Tool registered in the capability registry with server prefix
 */
export interface RegisteredTool extends MCPTool {
  serverName: string;
  originalName: string;
  prefixedName: string;
}

/**
 * Resource registered in the capability registry with server prefix
 */
export interface RegisteredResource extends MCPResource {
  serverName: string;
  originalUri: string;
  prefixedUri: string;
}

/**
 * Prompt registered in the capability registry with server prefix
 */
export interface RegisteredPrompt extends MCPPrompt {
  serverName: string;
  originalName: string;
  prefixedName: string;
}

/**
 * Server connection status
 */
export type ServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Server connection information
 */
export interface ServerConnection {
  name: string;
  config: UpstreamServerConfig;
  status: ServerStatus;
  lastError?: string;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  connectedAt?: Date;
}

// Hub configuration interface removed - now using CLI args

// =============================================================================
// Connector Interface Types
// =============================================================================

/**
 * Base connector interface for upstream servers
 */
export interface BaseConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(message: MCPMessage): Promise<MCPResponse>;
  discoverCapabilities(): Promise<{ tools: MCPTool[]; resources: MCPResource[]; prompts: MCPPrompt[] }>;
  isConnected(): boolean;
  on(event: 'message', listener: (message: MCPMessage) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'disconnect', listener: () => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

/**
 * Connector factory function type
 */
export type ConnectorFactory = (config: UpstreamServerConfig) => BaseConnector;

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Capability summary information
 */
export interface CapabilitySummary {
  totalTools: number;
  totalResources: number;
  totalPrompts: number;
  serverCount: number;
}

/**
 * Capability registry interface
 */
export interface CapabilityRegistry {
  registerTools(serverName: string, tools: MCPTool[]): void;
  registerResources(serverName: string, resources: MCPResource[]): void;
  registerPrompts(serverName: string, prompts: MCPPrompt[]): void;
  getTool(prefixedName: string): RegisteredTool | undefined;
  getResource(prefixedUri: string): RegisteredResource | undefined;
  getPrompt(prefixedName: string): RegisteredPrompt | undefined;
  getAllTools(): RegisteredTool[];
  getAllResources(): RegisteredResource[];
  getAllPrompts(): RegisteredPrompt[];
  getSummary(): CapabilitySummary;
  clearServer(serverName: string): void;
  clear(): void;
}

// =============================================================================
// Router Types
// =============================================================================

/**
 * Request routing information
 */
export interface RouteInfo {
  serverName: string;
  originalName: string;
  connector: BaseConnector;
}

/**
 * Router interface
 */
export interface RequestRouter {
  routeToolCall(prefixedName: string): RouteInfo | null;
  routeResourceRead(prefixedUri: string): RouteInfo | null;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Generic event emitter interface
 */
export interface EventEmitter {
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Prefix utility functions type
 */
export interface PrefixUtils {
  addPrefix(serverName: string, name: string): string;
  removePrefix(prefixedName: string): { serverName: string; originalName: string } | null;
  SEPARATOR: string;
} 

// Protocol version logic removed for simplified architecture 