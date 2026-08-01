/**
 * Stdio-based connector for upstream MCP servers
 * Uses official @modelcontextprotocol/sdk
 */
import { BaseConnector } from './BaseConnector.js';
import { MCPMessage, MCPResponse, StdioServerConfig } from '../types.js';
export declare class StdioConnector extends BaseConnector {
    private client?;
    private transport?;
    constructor(name: string, config: StdioServerConfig, timeout?: number);
    private get stdioConfig();
    connect(): Promise<void>;
    sendMessage(message: MCPMessage): Promise<MCPResponse>;
    protected sendRawMessage(message: MCPMessage): Promise<void>;
    disconnect(): Promise<void>;
}
