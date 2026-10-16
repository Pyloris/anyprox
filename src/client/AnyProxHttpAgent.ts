import * as http from 'node:http';
import * as https from 'node:https';
import type { ProxyPool } from '../core/ProxyPool.js';
import type { ProviderRegistry } from '../providers/index.js';

export interface AnyProxAgentOptions extends http.AgentOptions {
  pool: ProxyPool;
  providers: ProviderRegistry;
}

/**
 * Custom Node.js http.Agent / https.Agent that dynamically routes outgoing requests
 * through rotating AnyProx proxy endpoints.
 */
interface NodeAgentWithAddRequest {
  addRequest(req: http.ClientRequest, options: http.RequestOptions, port?: number): void;
}

export class AnyProxHttpAgent extends http.Agent {
  private pool: ProxyPool;
  private providers: ProviderRegistry;

  constructor(options: AnyProxAgentOptions) {
    super(options);
    this.pool = options.pool;
    this.providers = options.providers;
  }

  addRequest(req: http.ClientRequest, options: http.RequestOptions, port?: number): void {
    const endpoint = this.pool.selectEndpoint();

    if (!endpoint) {
      req.destroy(new Error('AnyProx: No active proxy endpoints available in pool'));
      return;
    }

    const provider = this.providers.get(endpoint.provider);
    if (!provider) {
      req.destroy(new Error(`AnyProx: Unknown provider '${endpoint.provider}'`));
      return;
    }

    try {
      // Reconstruct original target URL
      const protocol = (options as any).protocol || 'http:';
      const host = options.hostname || options.host || 'localhost';
      const targetPort = options.port || (protocol === 'https:' ? 443 : 80);
      const targetPath = options.path || '/';
      const originalUrl = `${protocol}//${host}${targetPort === 80 || targetPort === 443 ? '' : `:${targetPort}`}${targetPath}`;

      // Set target header
      req.setHeader('x-target-url', originalUrl);

      // Parse proxy endpoint URL to redirect connection
      const endpointObj = new URL(endpoint.url);
      options.hostname = endpointObj.hostname;
      options.host = endpointObj.host;
      options.port = endpointObj.port ? parseInt(endpointObj.port, 10) : (endpointObj.protocol === 'https:' ? 443 : 80);

      (http.Agent.prototype as unknown as NodeAgentWithAddRequest).addRequest.call(this, req, options, port);
    } catch (err) {
      req.destroy(err as Error);
    }
  }
}

export class AnyProxHttpsAgent extends https.Agent {
  private pool: ProxyPool;
  private providers: ProviderRegistry;

  constructor(options: AnyProxAgentOptions) {
    super(options);
    this.pool = options.pool;
    this.providers = options.providers;
  }

  addRequest(req: http.ClientRequest, options: https.RequestOptions, port?: number): void {
    const endpoint = this.pool.selectEndpoint();

    if (!endpoint) {
      req.destroy(new Error('AnyProx: No active proxy endpoints available in pool'));
      return;
    }

    const provider = this.providers.get(endpoint.provider);
    if (!provider) {
      req.destroy(new Error(`AnyProx: Unknown provider '${endpoint.provider}'`));
      return;
    }

    try {
      const protocol = (options as any).protocol || 'https:';
      const host = options.hostname || options.host || 'localhost';
      const targetPort = options.port || 443;
      const targetPath = options.path || '/';
      const originalUrl = `${protocol}//${host}${targetPort === 443 ? '' : `:${targetPort}`}${targetPath}`;

      // Set target header
      req.setHeader('x-target-url', originalUrl);

      const endpointObj = new URL(endpoint.url);
      options.hostname = endpointObj.hostname;
      options.host = endpointObj.host;
      options.port = endpointObj.port ? parseInt(endpointObj.port, 10) : 443;

      (https.Agent.prototype as unknown as NodeAgentWithAddRequest).addRequest.call(this, req, options, port);
    } catch (err) {
      req.destroy(err as Error);
    }
  }
}
