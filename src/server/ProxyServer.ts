import * as http from 'node:http';
import * as net from 'node:net';
import type * as stream from 'node:stream';
import type { ProxyPool } from '../core/ProxyPool.js';
import type { ProviderRegistry } from '../providers/index.js';
import { logger } from '../utils/logger.js';
import { sanitizeRequestHeaders } from '../utils/headerSanitizer.js';

export interface ProxyServerOptions {
  port?: number;
  host?: string;
  pool: ProxyPool;
  providers: ProviderRegistry;
  onRotate?: (endpointId: string, targetUrl: string) => void;
}

export class ProxyServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private pool: ProxyPool;
  private providers: ProviderRegistry;
  private onRotate?: (endpointId: string, targetUrl: string) => void;

  constructor(options: ProxyServerOptions) {
    this.port = options.port ?? 8080;
    this.host = options.host ?? '127.0.0.1';
    this.pool = options.pool;
    this.providers = options.providers;
    this.onRotate = options.onRotate;
  }

  /**
   * Start the local forward proxy server.
   */
  async start(): Promise<{ port: number; host: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((clientReq, clientRes) => {
        this.handleHttpRequest(clientReq, clientRes);
      });

      // Handle HTTPS CONNECT method
      this.server.on('connect', (req, clientSocket, head) => {
        this.handleConnect(req, clientSocket, head);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        resolve({ port: this.port, host: this.host });
      });
    });
  }

  /**
   * Handle incoming standard HTTP forward proxy requests.
   */
  private async handleHttpRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse
  ): Promise<void> {
    try {
      // Determine target URL from request
      let targetUrl = clientReq.url || '';

      // Check if target is in headers (e.g. X-Target-URL) or query param
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        const headerTarget = clientReq.headers['x-target-url'] as string | undefined;
        if (headerTarget) {
          targetUrl = headerTarget;
        } else {
          // Check ?url= parameter
          try {
            const parsed = new URL(targetUrl, `http://${this.host}:${this.port}`);
            const queryUrl = parsed.searchParams.get('url');
            if (queryUrl) {
              targetUrl = queryUrl;
            }
          } catch {
            // Keep original
          }
        }
      }

      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        clientRes.writeHead(400, { 'Content-Type': 'application/json' });
        clientRes.end(
          JSON.stringify({
            error: 'AnyProx: Missing or invalid target URL',
            usage: 'Send standard proxy requests or use X-Target-URL header / ?url= query parameter',
          })
        );
        return;
      }

      // Select next rotating proxy endpoint
      const endpoint = this.pool.selectEndpoint({ targetUrl, method: clientReq.method });
      if (!endpoint) {
        clientRes.writeHead(503, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ error: 'AnyProx: No active proxy endpoints in pool' }));
        return;
      }

      const provider = this.providers.get(endpoint.provider);
      if (!provider) {
        clientRes.writeHead(500, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({ error: `AnyProx: Unknown provider ${endpoint.provider}` }));
        return;
      }

      this.onRotate?.(endpoint.id, targetUrl);

      // Collect request body
      const chunks: Buffer[] = [];
      for await (const chunk of clientReq) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

      // Prepare outgoing proxy request
      const sanitizedHeaders = sanitizeRequestHeaders(clientReq.headers as any, targetUrl);
      const outgoing = provider.formatRequest(endpoint, targetUrl, {
        method: clientReq.method,
        headers: sanitizedHeaders,
        body: ['GET', 'HEAD'].includes(clientReq.method || 'GET') ? null : (body as any),
      });

      // Dispatch request to cloud proxy endpoint
      const proxyRes = await fetch(outgoing.url, {
        method: outgoing.method,
        headers: outgoing.headers,
        body: outgoing.body,
      });

      // Forward response headers back to client
      const resHeaders: Record<string, string> = {};
      proxyRes.headers.forEach((v, k) => {
        if (!['content-encoding', 'transfer-encoding'].includes(k.toLowerCase())) {
          resHeaders[k] = v;
        }
      });

      clientRes.writeHead(proxyRes.status, resHeaders);

      if (proxyRes.body) {
        const reader = proxyRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          clientRes.write(value);
        }
      }
      clientRes.end();

      this.pool.recordSuccess(endpoint.id);
    } catch (err: unknown) {
      logger.error(`Forward proxy error: ${(err as Error).message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      }
      clientRes.end(JSON.stringify({ error: 'AnyProx: Proxy forwarding failed', message: (err as Error).message }));
    }
  }

  /**
   * Handle HTTPS CONNECT method for TCP tunneling.
   */
  private handleConnect(
    req: http.IncomingMessage,
    clientSocket: stream.Duplex,
    head: Buffer
  ): void {
    const [targetHost, targetPortStr] = (req.url || '').split(':');
    const targetPort = parseInt(targetPortStr || '443', 10);

    if (!targetHost) {
      clientSocket.destroy();
      return;
    }

    // Tunnel directly or through upstream proxy
    const serverSocket = net.connect(targetPort, targetHost, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      logger.debug(`CONNECT tunnel error: ${err.message}`);
      clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      logger.debug(`Client socket error: ${err.message}`);
      serverSocket.destroy();
    });
  }

  /**
   * Stop the local forward proxy server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
