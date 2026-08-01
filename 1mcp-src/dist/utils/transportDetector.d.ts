/**
 * Transport detection utility for MCP servers
 * Supports both modern Streamable HTTP and legacy SSE transports
 */
export interface TransportDetectionResult {
    type: 'streamable-http' | 'legacy-sse' | 'unknown';
    endpoint?: string;
}
/**
 * Detect the transport type of an MCP server
 */
export declare function detectTransport(serverUrl: string): Promise<TransportDetectionResult>;
