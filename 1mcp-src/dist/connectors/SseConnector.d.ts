/**
 * SSE-based connector for upstream MCP servers.
 * Uses official @modelcontextprotocol/sdk
 */
import { BaseConnector } from './BaseConnector.js';
import { MCPMessage, MCPResponse, SseServerConfig } from '../types.js';
export declare class SseConnector extends BaseConnector {
    private client?;
    private transport?;
    constructor(name: string, config: SseServerConfig, timeout?: number);
    private get sseConfig();
    connect(): Promise<void>;
    sendMessage(message: MCPMessage): Promise<MCPResponse>;
    protected sendRawMessage(message: MCPMessage): Promise<void>;
    disconnect(): Promise<void>;
}
