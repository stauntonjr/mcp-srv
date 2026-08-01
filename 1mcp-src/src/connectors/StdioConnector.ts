/**
 * Stdio-based connector for upstream MCP servers
 * Uses official @modelcontextprotocol/sdk
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { BaseConnector } from './BaseConnector.js';
import { MCPMessage, MCPRequest, MCPResponse, StdioServerConfig } from '../types.js';

const PermissiveResultSchema = z.any();

export class StdioConnector extends BaseConnector {
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(name: string, config: StdioServerConfig, timeout = 10000) {
    super(name, config, timeout);
  }

  private get stdioConfig(): StdioServerConfig {
    return this.config as StdioServerConfig;
  }

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    this.setStatus('connecting');

    try {
      this.client = new Client(
        {
          name: '1mcp-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      this.transport = new StdioClientTransport({
        command: this.stdioConfig.command,
        args: this.stdioConfig.args || [],
        env: this.stdioConfig.env || {},
        cwd: this.stdioConfig.cwd
      });

      await this.client.connect(this.transport);
      this.setStatus('connected');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.setStatus('error', `Failed to connect: ${errorMessage}`);
      throw error;
    }
  }

  async sendMessage(message: MCPMessage): Promise<MCPResponse> {
    if (!this.client || !this.isConnected()) {
      throw new Error(`Connector ${this.name} is not connected`);
    }

    if ('error' in message) {
      throw new Error('Cannot send response message to upstream server');
    }

    try {
      const request = message as MCPRequest;
      
      const result = await this.client.request({
        method: request.method,
        params: request.params || {}
      }, PermissiveResultSchema, { timeout: this.timeout });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: (message as MCPRequest).id,
        error: {
          code: (error as any)?.code || -32603,
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  protected async sendRawMessage(message: MCPMessage): Promise<void> {
    // For stdio transport, use the sendMessage method
    await this.sendMessage(message);
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
    
    this.client = undefined;
    this.setStatus('disconnected');
    this.cleanup();
  }
} 