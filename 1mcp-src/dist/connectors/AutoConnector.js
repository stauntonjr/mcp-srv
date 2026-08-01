/**
 * Auto-detecting connector that supports both Streamable HTTP and legacy SSE
 */
import { BaseConnector } from './BaseConnector.js';
import { StreamableHttpConnector } from './StreamableHttpConnector.js';
import { SseConnector } from './SseConnector.js';
import { detectTransport } from '../utils/transportDetector.js';
export class AutoConnector extends BaseConnector {
    actualConnector;
    detectedType;
    constructor(name, config, timeout = 10000) {
        super(name, config, timeout);
    }
    async connect() {
        if (this.isConnected()) {
            return;
        }
        this.setStatus('connecting');
        try {
            const url = this.config.url;
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
                this.actualConnector = new StreamableHttpConnector(this.name, this.config, this.timeout);
            }
            else {
                this.actualConnector = new SseConnector(this.name, this.config, this.timeout);
            }
            if (!this.actualConnector) {
                throw new Error('Connector could not be initialized');
            }
            await this.actualConnector.connect();
            this.setStatus('connected');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.setStatus('error', `Failed to connect: ${errorMessage}`);
            throw error;
        }
    }
    async sendMessage(message) {
        if (!this.actualConnector) {
            throw new Error(`AutoConnector ${this.name} is not connected`);
        }
        return this.actualConnector.sendMessage(message);
    }
    async sendRawMessage(message) {
        if (!this.actualConnector) {
            throw new Error(`AutoConnector ${this.name} is not connected`);
        }
        await this.actualConnector.sendMessage(message);
    }
    async disconnect() {
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
//# sourceMappingURL=AutoConnector.js.map