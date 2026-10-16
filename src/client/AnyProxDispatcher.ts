import { Dispatcher } from 'undici';
import type { ProxyPool } from '../core/ProxyPool.js';
import type { ProviderRegistry } from '../providers/index.js';

export interface AnyProxDispatcherOptions extends Dispatcher.DispatchOptions {
  pool: ProxyPool;
  providers: ProviderRegistry;
}

/**
 * Undici Dispatcher implementation for AnyProx.
 * Enables seamless integration with Node 18+ global fetch:
 * fetch('https://target.com', { dispatcher: anyprox.createDispatcher() });
 */
export class AnyProxDispatcher extends Dispatcher {
  private pool: ProxyPool;
  private providers: ProviderRegistry;

  constructor(options: { pool: ProxyPool; providers: ProviderRegistry }) {
    super();
    this.pool = options.pool;
    this.providers = options.providers;
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const endpoint = this.pool.selectEndpoint();

    if (!endpoint) {
      handler.onError?.(new Error('AnyProx: No active proxy endpoints available in pool'));
      return false;
    }

    const provider = this.providers.get(endpoint.provider);
    if (!provider) {
      handler.onError?.(new Error(`AnyProx: Unknown provider '${endpoint.provider}'`));
      return false;
    }

    try {
      const targetUrl = new URL(opts.path, opts.origin as string).toString();
      const endpointObj = new URL(endpoint.url);

      const modifiedOpts: Dispatcher.DispatchOptions = {
        ...opts,
        origin: endpointObj.origin,
        path: endpointObj.pathname + (endpointObj.search ? endpointObj.search : ''),
        headers: {
          ...(typeof opts.headers === 'object' ? opts.headers : {}),
          'x-target-url': targetUrl,
        },
      };

      // Dispatch to global Undici agent or default client
      return (Dispatcher as any).getGlobalDispatcher().dispatch(modifiedOpts, handler);
    } catch (err) {
      handler.onError?.(err as Error);
      return false;
    }
  }

  async close(): Promise<void> {
    // No-op
  }

  async destroy(): Promise<void> {
    // No-op
  }
}
