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
export async function detectTransport(serverUrl: string): Promise<TransportDetectionResult> {
  try {
    const result = await tryStreamableHttp(serverUrl);
    if (result.type === 'streamable-http') {
      return result;
    }
  } catch {
    // Silently fall back to legacy SSE
  }

  try {
    const result = await tryLegacySse(serverUrl);
    if (result.type === 'legacy-sse') {
      return result;
    }
  } catch {
    // Both methods failed
  }

  return { type: 'unknown' };
}

/**
 * Try to detect Streamable HTTP transport
 */
async function tryStreamableHttp(serverUrl: string): Promise<TransportDetectionResult> {
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        // protocolVersion removed for simplified architecture
        capabilities: {},
        clientInfo: {
          name: '1mcp-detector',
          version: '1.0.0'
        }
      }
    }),
  });

  if (response.ok) {
    return { type: 'streamable-http', endpoint: serverUrl };
  }

  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

/**
 * Try to detect legacy SSE transport
 */
async function tryLegacySse(serverUrl: string): Promise<TransportDetectionResult> {
  const response = await fetch(serverUrl, {
    method: 'GET',
    headers: { 
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    },
  });

  if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
    return { type: 'legacy-sse', endpoint: serverUrl };
  }

  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}