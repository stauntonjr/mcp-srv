/**
 * Auto-detecting connector that supports both Streamable HTTP and legacy SSE
 */

import { BaseConnector } from './BaseConnector.js';
import { StreamableHttpConnector } from './StreamableHttpConnector.js';
import { SseConnector } from './SseConnector.js';
import { detectTransport } from '../utils/transportDetector.js';
import { MCPMessage, UpstreamServerConfig } from '../types.js';

export class AutoConnector extends BaseConnector {
  private actualConnector?: BaseConnector;
  private detectedType?: 'streamable-http' | 'legacy-sse';

  constructor(name: string, config: UpstreamServerConfig, timeout = 10000) {
    super(name, config, timeout);
  }

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    this.setStatus('connecting');

    try {
      const url = (this.config as any).url;
      if (!url) {
        throw new Error('No URL provided for transport detection');
      }
      
      const detection = await detectTransport(url);
      
      if (detection.type === 'unknown') {
        throw new Error(`Unable to detect transport type for ${url}`);
      }

      this.detectedType = detection.type;

      // Create appropriate connector based on detected type
      if (detection.type === 'streamable-http') {
        this.actualConnector = new StreamableHttpConnector(
          this.name, 
          this.config as any, 
          this.timeout
        );
      } else {
        this.actualConnector = new SseConnector(
          this.name, 
          this.config as any, 
          this.timeout
        );
      }

      if (!this.actualConnector) {
        throw new Error('Connector could not be initialized');
      }
      
      await this.actualConnector.connect();
      this.setStatus('connected');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.setStatus('error', `Failed to connect: ${errorMessage}`);
      throw error;
    }
  }

  async sendMessage(message: MCPMessage) {
    if (!this.actualConnector) {
      throw new Error(`AutoConnector ${this.name} is not connected`);
    }
    return this.actualConnector.sendMessage(message);
  }

  protected async sendRawMessage(message: MCPMessage): Promise<void> {
    if (!this.actualConnector) {
      throw new Error(`AutoConnector ${this.name} is not connected`);
    }
    await this.actualConnector.sendMessage(message);
  }

  async disconnect(): Promise<void> {
    if (this.actualConnector) {
      await this.actualConnector.disconnect();
      this.actualConnector = undefined;
    }
    
    this.setStatus('disconnected');
    this.cleanup();
  }

  async discoverCapabilities() {
    if (!this.actualConnector) {
      throw new Error(`AutoConnector ${this.name} is not connected`);
    }
    return this.actualConnector.discoverCapabilities();
  }
}