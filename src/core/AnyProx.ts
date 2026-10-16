import type {
  AnyProxConfig,
  AnyProxOptions,
  AnyProxRequestInit,
  DeployOptions,
  HealthCheckResult,
  ProxyEndpoint,
  ProxyProvider,
} from '../types/index.js';
import { loadConfig } from '../utils/configLoader.js';
import { ProxyPool } from './ProxyPool.js';
import { ProviderRegistry } from '../providers/index.js';
import { FileStateStore } from '../state/FileStateStore.js';
import { MemoryStateStore } from '../state/MemoryStateStore.js';
import { AnyProxClient } from '../client/AnyProxClient.js';
import { AnyProxHttpAgent, AnyProxHttpsAgent } from '../client/AnyProxHttpAgent.js';
import { AnyProxDispatcher } from '../client/AnyProxDispatcher.js';
import { ProxyServer, type ProxyServerOptions } from '../server/ProxyServer.js';

export class AnyProx {
  private _config: AnyProxConfig;
  private _pool: ProxyPool;
  private _providers: ProviderRegistry;
  private _client: AnyProxClient;
  private _initialized = false;

  constructor(options: AnyProxOptions = {}) {
    this._config = loadConfig(options);
    this._providers = new ProviderRegistry();

    // Select state store based on configuration
    const store =
      this._config.stateStore === 'memory'
        ? new MemoryStateStore()
        : new FileStateStore();

    this._pool = new ProxyPool({
      strategy: this._config.pool?.strategy,
      circuitBreaker: this._config.pool?.circuitBreaker,
      stateStore: store,
    });

    this._client = new AnyProxClient({
      pool: this._pool,
      providers: this._providers,
    });

    if (options.autoInit) {
      void this.init();
    }
  }

  /**
   * Initializes the pool from state storage and configures providers.
   */
  async init(): Promise<this> {
    if (this._initialized) {
      return this;
    }

    // Initialize configured providers
    if (this._config.providers?.cloudflare) {
      const cfProvider = this._providers.get('cloudflare');
      if (cfProvider && (this._config.providers.cloudflare.apiToken || process.env.CF_API_TOKEN)) {
        await cfProvider.init(this._config.providers.cloudflare as unknown as Record<string, unknown>);
      }
    }

    if (this._config.providers?.aws) {
      const awsProvider = this._providers.get('aws');
      if (awsProvider && (this._config.providers.aws.accessKeyId || process.env.AWS_ACCESS_KEY_ID)) {
        await awsProvider.init(this._config.providers.aws as unknown as Record<string, unknown>);
      }
    }

    if (this._config.providers?.generic) {
      const genericProvider = this._providers.get('generic');
      if (genericProvider) {
        await genericProvider.init(this._config.providers.generic as unknown as Record<string, unknown>);
      }
    }

    // Load persisted endpoints
    await this._pool.init();
    this._initialized = true;
    return this;
  }

  /**
   * Provision new proxy endpoints via a cloud provider and add them to the rotation pool.
   */
  async deploy(
    options: DeployOptions & { provider?: string } = {}
  ): Promise<ProxyEndpoint[]> {
    await this.ensureInitialized();

    const providerName = options.provider || this._config.defaultProvider || 'cloudflare';
    const provider = this._providers.get(providerName);

    if (!provider) {
      throw new Error(`AnyProx: Unknown provider '${providerName}'. Registered: ${this._providers.list().map((p) => p.name).join(', ')}`);
    }

    const count = options.count ?? this._config.pool?.defaultCount ?? 1;
    const endpoints = await provider.deploy({ ...options, count });

    await this._pool.addEndpoints(endpoints);
    return endpoints;
  }

  /**
   * List all known endpoints in the pool.
   */
  async list(refreshFromProvider = false): Promise<ProxyEndpoint[]> {
    await this.ensureInitialized();

    if (refreshFromProvider) {
      const providerName = this._config.defaultProvider || 'cloudflare';
      const provider = this._providers.get(providerName);
      if (provider) {
        const remote = await provider.list();
        await this._pool.addEndpoints(remote);
      }
    }

    return this._pool.getAllEndpoints();
  }

  /**
   * Run health checks and egress IP verification on endpoints in the pool.
   */
  async test(
    endpoints?: ProxyEndpoint[]
  ): Promise<Array<{ endpoint: ProxyEndpoint; health: HealthCheckResult }>> {
    await this.ensureInitialized();

    const targets = endpoints || this._pool.getAllEndpoints();
    const results: Array<{ endpoint: ProxyEndpoint; health: HealthCheckResult }> = [];

    for (const ep of targets) {
      const provider = this._providers.get(ep.provider);
      if (!provider) continue;

      const health = await provider.healthCheck(ep);
      if (health.healthy && health.egressIp) {
        ep.egressIp = health.egressIp;
        this._pool.recordSuccess(ep.id, health.latencyMs);
      } else {
        this._pool.recordFailure(ep.id, health.statusCode, health.error);
      }

      results.push({ endpoint: ep, health });
    }

    // Update state store with detected egress IPs
    await this._pool.addEndpoints(targets);
    return results;
  }

  /**
   * Destroy specific or all proxy endpoints.
   */
  async destroy(endpointIds?: string[]): Promise<void> {
    await this.ensureInitialized();

    const all = this._pool.getAllEndpoints();
    const toDelete = endpointIds && endpointIds.length > 0
      ? all.filter((ep) => endpointIds.includes(ep.id))
      : all;

    // Group by provider for efficient teardown
    const byProvider = new Map<string, string[]>();
    for (const ep of toDelete) {
      const list = byProvider.get(ep.provider) || [];
      list.push(ep.id);
      byProvider.set(ep.provider, list);
    }

    for (const [pName, ids] of byProvider) {
      const provider = this._providers.get(pName);
      if (provider) {
        await provider.destroy(ids);
      }
    }

    await this._pool.removeEndpoints(toDelete.map((ep) => ep.id));
  }

  /**
   * Register a custom third-party provider plugin.
   */
  registerProvider(provider: ProxyProvider): void {
    this._providers.register(provider);
  }

  /**
   * Dispatches an HTTP request through an automatically rotating proxy endpoint.
   */
  async fetch(url: string, init?: AnyProxRequestInit): Promise<Response> {
    await this.ensureInitialized();
    return this._client.fetch(url, init);
  }

  /**
   * Convenience helpers for GET, POST, PUT, DELETE.
   */
  async get(url: string, init?: Omit<AnyProxRequestInit, 'method'>): Promise<Response> {
    await this.ensureInitialized();
    return this._client.get(url, init);
  }

  async post(url: string, body?: any, init?: Omit<AnyProxRequestInit, 'method' | 'body'>): Promise<Response> {
    await this.ensureInitialized();
    return this._client.post(url, body, init);
  }

  async put(url: string, body?: any, init?: Omit<AnyProxRequestInit, 'method' | 'body'>): Promise<Response> {
    await this.ensureInitialized();
    return this._client.put(url, body, init);
  }

  async delete(url: string, init?: Omit<AnyProxRequestInit, 'method'>): Promise<Response> {
    await this.ensureInitialized();
    return this._client.delete(url, init);
  }

  /**
   * Create an HTTP Agent for axios, got, and node:http.
   */
  createHttpAgent(): AnyProxHttpAgent {
    return new AnyProxHttpAgent({
      pool: this._pool,
      providers: this._providers,
    });
  }

  /**
   * Create an HTTPS Agent for axios, got, and node:https.
   */
  createHttpsAgent(): AnyProxHttpsAgent {
    return new AnyProxHttpsAgent({
      pool: this._pool,
      providers: this._providers,
    });
  }

  /**
   * Create an Undici Dispatcher for Node 18+ global fetch.
   */
  createDispatcher(): AnyProxDispatcher {
    return new AnyProxDispatcher({
      pool: this._pool,
      providers: this._providers,
    });
  }

  /**
   * Launch a local forward proxy server for Burp Suite, Nuclei, ZAP, curl.
   */
  async serve(options: Partial<ProxyServerOptions> = {}): Promise<ProxyServer> {
    await this.ensureInitialized();

    const server = new ProxyServer({
      port: options.port ?? this._config.server?.port ?? 8080,
      host: options.host ?? this._config.server?.host ?? '127.0.0.1',
      pool: this._pool,
      providers: this._providers,
      onRotate: options.onRotate,
    });

    await server.start();
    return server;
  }

  get pool(): ProxyPool {
    return this._pool;
  }

  get providers(): ProviderRegistry {
    return this._providers;
  }

  get config(): AnyProxConfig {
    return this._config;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this._initialized) {
      await this.init();
    }
  }
}
