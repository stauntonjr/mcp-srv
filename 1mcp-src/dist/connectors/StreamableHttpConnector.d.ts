/**
 * Streamable HTTP connector for upstream MCP servers
 * Uses official @modelcontextprotocol/sdk
 */
import { BaseConnector } from './BaseConnector.js';
import { MCPMessage, MCPResponse, StreamableHttpServerConfig } from '../types.js';
export declare class StreamableHttpConnector extends BaseConnector {
    private client?;
    private transport?;
    constructor(name: string, config: StreamableHttpServerConfig, timeout?: number);
    private get httpConfig();
    connect(): Promise<void>;
    sendMessage(message: MCPMessage): Promise<MCPResponse>;
    protected sendRawMessage(message: MCPMessage): Promise<void>;
    disconnect(): Promise<void>;
}
