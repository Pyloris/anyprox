import type {
  AnyProxRequestInit,
  StrategyContext,
} from '../types/index.js';
import type { ProxyPool } from '../core/ProxyPool.js';
import type { ProviderRegistry } from '../providers/index.js';

export interface AnyProxClientOptions {
  pool: ProxyPool;
  providers: ProviderRegistry;
  defaultRetries?: number;
}

export class AnyProxClient {
  private pool: ProxyPool;
  private providers: ProviderRegistry;
  private defaultRetries: number;

  constructor(options: AnyProxClientOptions) {
    this.pool = options.pool;
    this.providers = options.providers;
    this.defaultRetries = options.defaultRetries ?? 3;
  }

  /**
   * Performs an HTTP request routed through an automatically rotating proxy endpoint.
   * Handles automatic retries and endpoint failover on rate limits or network errors.
   */
  async fetch(url: string, init: AnyProxRequestInit = {}): Promise<Response> {
    const maxRetries = init.rotation?.maxRetries ?? this.defaultRetries;
    const retryOnRateLimit = init.rotation?.retryOnRateLimit ?? true;
    let attempt = 0;
    let lastError: Error | null = null;

    const domain = new URL(url).hostname;
    const context: StrategyContext = {
      targetUrl: url,
      method: init.method || 'GET',
      sessionId: init.rotation?.sessionId,
      domain,
    };

    while (attempt <= maxRetries) {
      const endpoint = this.pool.selectEndpoint(context);
      if (!endpoint) {
        throw new Error(
          'AnyProx: No active proxy endpoints available in the pool. ' +
          'Deploy endpoints first via anyprox.deploy() or check health status.'
        );
      }

      const provider = this.providers.get(endpoint.provider);
      if (!provider) {
        throw new Error(`AnyProx: Unknown provider '${endpoint.provider}' for endpoint '${endpoint.id}'`);
      }

      const startTime = Date.now();
      try {
        const proxyReq = provider.formatRequest(endpoint, url, init);

        const response = await fetch(proxyReq.url, {
          method: proxyReq.method,
          headers: proxyReq.headers,
          body: proxyReq.body,
          signal: init.signal,
        });

        const latencyMs = Date.now() - startTime;

        // Check if rate limited or blocked by WAF
        const shouldRetry = retryOnRateLimit && [429, 403, 502, 503, 504].includes(response.status);

        if (shouldRetry && attempt < maxRetries) {
          this.pool.recordFailure(endpoint.id, response.status);
          attempt++;
          // Exponential backoff delay
          await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 5000)));
          continue;
        }

        // Record success and return response
        this.pool.recordSuccess(endpoint.id, latencyMs);
        return response;
      } catch (err) {
        this.pool.recordFailure(endpoint.id, undefined, err);
        lastError = err as Error;
        attempt++;

        if (attempt > maxRetries) {
          break;
        }

        await new Promise((r) => setTimeout(r, Math.min(500 * Math.pow(2, attempt), 3000)));
      }
    }

    throw lastError || new Error(`AnyProx request to ${url} failed after ${maxRetries} retries`);
  }

  /**
   * Helper for GET requests.
   */
  async get(url: string, init?: Omit<AnyProxRequestInit, 'method'>): Promise<Response> {
    return this.fetch(url, { ...init, method: 'GET' });
  }

  /**
   * Helper for POST requests.
   */
  async post(url: string, body?: any, init?: Omit<AnyProxRequestInit, 'method' | 'body'>): Promise<Response> {
    const isJson = body && typeof body === 'object' && !(body instanceof Uint8Array);
    const headers = {
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    };

    return this.fetch(url, {
      ...init,
      method: 'POST',
      headers,
      body: isJson ? JSON.stringify(body) : body,
    });
  }

  /**
   * Helper for PUT requests.
   */
  async put(url: string, body?: any, init?: Omit<AnyProxRequestInit, 'method' | 'body'>): Promise<Response> {
    const isJson = body && typeof body === 'object' && !(body instanceof Uint8Array);
    const headers = {
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    };

    return this.fetch(url, {
      ...init,
      method: 'PUT',
      headers,
      body: isJson ? JSON.stringify(body) : body,
    });
  }

  /**
   * Helper for DELETE requests.
   */
  async delete(url: string, init?: Omit<AnyProxRequestInit, 'method'>): Promise<Response> {
    return this.fetch(url, { ...init, method: 'DELETE' });
  }
}
