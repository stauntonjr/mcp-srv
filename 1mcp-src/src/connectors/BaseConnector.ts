/**
 * Base connector class for upstream MCP servers
 * Provides common functionality and event handling for all connector types
 */

import { EventEmitter } from 'events';
import { BaseConnector as IBaseConnector, MCPMessage, MCPResponse, MCPTool, MCPResource, UpstreamServerConfig, ServerStatus, MCPRequest, MCPNotification, MCPPrompt } from '../types.js';

export abstract class BaseConnector extends EventEmitter implements IBaseConnector {
  protected _status: ServerStatus = 'disconnected';
  protected _lastError?: string;
  protected _connectedAt?: Date;
  protected _messageId = 0;
  protected _pendingRequests = new Map<string | number, {
    resolve: (response: MCPResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(
    public readonly name: string,
    public readonly config: UpstreamServerConfig,
    protected readonly timeout: number = 10000
  ) {
    super();
    this.setMaxListeners(100);
  }

  get status(): ServerStatus {
    return this._status;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  get connectedAt(): Date | undefined {
    return this._connectedAt;
  }

  isConnected(): boolean {
    return this._status === 'connected';
  }

  abstract connect(): Promise<void>;

  abstract disconnect(): Promise<void>;

  async sendMessage(message: MCPMessage): Promise<MCPResponse> {
    if (!this.isConnected() && this._status !== 'connecting') {
      throw new Error(`Cannot send message: connector ${this.name} is not connected`);
    }

    // Handle notifications without waiting for response
    if (!('id' in message) || message.id === undefined) {
      await this.sendRawMessage(message);
      return { jsonrpc: '2.0', id: 0, result: null };
    }

    return new Promise((resolve, reject) => {
      const messageId = message.id;
      
      const timeoutHandle = setTimeout(() => {
        this._pendingRequests.delete(messageId);
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      }, this.timeout);

      this._pendingRequests.set(messageId, {
        resolve,
        reject,
        timeout: timeoutHandle
      });

      this.sendRawMessage(message).catch(error => {
        this._pendingRequests.delete(messageId);
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  protected abstract sendRawMessage(message: MCPMessage): Promise<void>;

  private async discoverPrompts(): Promise<MCPPrompt[]> {
    try {
      const promptsResponse = await this.sendMessage({
        jsonrpc: '2.0',
        id: this.generateMessageId(),
        method: 'prompts/list',
        params: {}
      });

      const rawPrompts: any[] = promptsResponse.result?.prompts || [];
      
      return rawPrompts.map(prompt => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments || []
      }));
    } catch {
      // If server doesn't support prompts, return empty array
      console.log(`📝 Server ${this.name} does not support prompts`);
      return [];
    }
  }

  /**
   * Discover all capabilities from the server
   */
  async discoverCapabilities(): Promise<{ tools: MCPTool[]; resources: MCPResource[]; prompts: MCPPrompt[] }> {
    console.log(`🔍 Discovering capabilities for ${this.name}...`);
    
    const [tools, resources, prompts] = await Promise.allSettled([
      this.discoverTools(),
      this.discoverResources(),
      this.discoverPrompts()
    ]);

    const discoveredTools = tools.status === 'fulfilled' ? tools.value : [];
    const discoveredResources = resources.status === 'fulfilled' ? resources.value : [];
    const discoveredPrompts = prompts.status === 'fulfilled' ? prompts.value : [];

    if (tools.status === 'rejected') {
      console.warn(`⚠️  Failed to discover tools for ${this.name}: ${tools.reason}`);
    }
    
    if (resources.status === 'rejected') {
      console.warn(`⚠️  Failed to discover resources for ${this.name}: ${resources.reason}`);
    }

    if (prompts.status === 'rejected') {
      console.warn(`⚠️  Failed to discover prompts for ${this.name}: ${prompts.reason}`);
    }

    console.log(`✅ Discovered ${discoveredTools.length} tools, ${discoveredResources.length} resources, ${discoveredPrompts.length} prompts for ${this.name}`);
    
    return {
      tools: discoveredTools,
      resources: discoveredResources,
      prompts: discoveredPrompts
    };
  }

  private async discoverTools(): Promise<MCPTool[]> {
    try {
      const toolsResponse = await this.sendMessage({
        jsonrpc: '2.0',
        id: this.generateMessageId(),
        method: 'tools/list',
        params: {}
      });

      const rawTools: any[] = toolsResponse.result?.tools || [];
      
      return rawTools.map(tool => {
        // Normalize parameter schema
        let parameters;
        if (tool.inputSchema) {
          parameters = {
            type: 'object' as const,
            properties: tool.inputSchema.properties || {},
            required: tool.inputSchema.required || []
          };
        } else if (tool.parameters) {
          parameters = tool.parameters;
        } else {
          parameters = {
            type: 'object' as const,
            properties: {},
            required: []
          };
        }

        return {
          name: tool.name,
          title: tool.title || tool.name,
          description: tool.description,
          parameters
        };
      });
    } catch (error) {
      throw new Error(`Failed to discover tools: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async discoverResources(): Promise<MCPResource[]> {
    try {
      const resourcesResponse = await this.sendMessage({
        jsonrpc: '2.0',
        id: this.generateMessageId(),
        method: 'resources/list',
        params: {}
      });
      
      return resourcesResponse.result?.resources || [];
    } catch {
      // Server doesn't support resources - that's OK
      return [];
    }
  }

  protected handleResponse(response: MCPResponse): void {
    const messageId = response.id;
    const pending = this._pendingRequests.get(messageId);

    if (!pending) {
      return;
    }

    this._pendingRequests.delete(messageId);
    clearTimeout(pending.timeout);

    if (response.error) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response);
    }
  }

  protected handleNotification(notification: MCPRequest | MCPNotification): void {
    if ('method' in notification) {
      this.emit('notification', notification);
    }
  }

  protected setStatus(status: ServerStatus, error?: string): void {
    const previousStatus = this._status;
    this._status = status;
    this._lastError = error;

    if (status === 'connected' && previousStatus !== 'connected') {
      this._connectedAt = new Date();
      console.log(`✅ Connected to ${this.name}`);
      this.emit('connected');
    } else if (status === 'disconnected' && previousStatus !== 'disconnected') {
      this._connectedAt = undefined;
      this.emit('disconnected');
    } else if (status === 'error') {
      console.error(`❌ ${this.name}: ${error}`);
      this.emit('error', new Error(error || 'Unknown error'));
    }

    this.emit('statusChanged', status, error);
  }

  protected generateMessageId(): number {
    return ++this._messageId;
  }

  protected getRequestId(): number {
    return ++this._messageId;
  }

  protected cleanup(): void {
    for (const [_messageId, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this._pendingRequests.clear();
    this.removeAllListeners();
  }

  protected async performHandshake(): Promise<void> {
    try {
      const response = await this.sendMessage({
        jsonrpc: '2.0',
        id: this.generateMessageId(),
        method: 'initialize',
        params: {
          capabilities: {
            tools: [],
            resources: []
          },
          clientInfo: {
            name: '1mcp',
            version: '1.0.0'
          }
        }
      });

      if (response.error) {
        throw new Error(`Handshake failed: ${response.error.message}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Handshake failed: ${errorMessage}`);
    }
  }
} 