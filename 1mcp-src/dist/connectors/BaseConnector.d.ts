/**
 * Base connector class for upstream MCP servers
 * Provides common functionality and event handling for all connector types
 */
import { EventEmitter } from 'events';
import { BaseConnector as IBaseConnector, MCPMessage, MCPResponse, MCPTool, MCPResource, UpstreamServerConfig, ServerStatus, MCPRequest, MCPNotification, MCPPrompt } from '../types.js';
export declare abstract class BaseConnector extends EventEmitter implements IBaseConnector {
    readonly name: string;
    readonly config: UpstreamServerConfig;
    protected readonly timeout: number;
    protected _status: ServerStatus;
    protected _lastError?: string;
    protected _connectedAt?: Date;
    protected _messageId: number;
    protected _pendingRequests: Map<string | number, {
        resolve: (response: MCPResponse) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>;
    constructor(name: string, config: UpstreamServerConfig, timeout?: number);
    get status(): ServerStatus;
    get lastError(): string | undefined;
    get connectedAt(): Date | undefined;
    isConnected(): boolean;
    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
    sendMessage(message: MCPMessage): Promise<MCPResponse>;
    protected abstract sendRawMessage(message: MCPMessage): Promise<void>;
    private discoverPrompts;
    /**
     * Discover all capabilities from the server
     */
    discoverCapabilities(): Promise<{
        tools: MCPTool[];
        resources: MCPResource[];
        prompts: MCPPrompt[];
    }>;
    private discoverTools;
    private discoverResources;
    protected handleResponse(response: MCPResponse): void;
    protected handleNotification(notification: MCPRequest | MCPNotification): void;
    protected setStatus(status: ServerStatus, error?: string): void;
    protected generateMessageId(): number;
    protected getRequestId(): number;
    protected cleanup(): void;
    protected performHandshake(): Promise<void>;
}
