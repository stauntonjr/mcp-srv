/**
 * Auto-detecting connector that supports both Streamable HTTP and legacy SSE
 */
import { BaseConnector } from './BaseConnector.js';
import { MCPMessage, UpstreamServerConfig } from '../types.js';
export declare class AutoConnector extends BaseConnector {
    private actualConnector?;
    private detectedType?;
    constructor(name: string, config: UpstreamServerConfig, timeout?: number);
    connect(): Promise<void>;
    sendMessage(message: MCPMessage): Promise<import("../types.js").MCPResponse>;
    protected sendRawMessage(message: MCPMessage): Promise<void>;
    disconnect(): Promise<void>;
    discoverCapabilities(): Promise<{
        tools: import("../types.js").MCPTool[];
        resources: import("../types.js").MCPResource[];
        prompts: import("../types.js").MCPPrompt[];
    }>;
}
