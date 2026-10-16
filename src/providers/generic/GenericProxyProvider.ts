import type {
  DeployOptions,
  GenericProviderConfig,
  HealthCheckResult,
  OutgoingProxyRequest,
  ProxyEndpoint,
  ProxyProvider,
} from '../../types/index.js';
import { checkEndpointHealth } from '../../utils/ipChecker.js';
import { sanitizeRequestHeaders } from '../../utils/headerSanitizer.js';

export class GenericProxyProvider implements ProxyProvider {
  readonly name = 'generic';
  private config: GenericProviderConfig = { proxies: [] };
  private endpoints: ProxyEndpoint[] = [];

  constructor(config?: GenericProviderConfig) {
    if (config) {
      this.config = config;
    }
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...(config as GenericProviderConfig) };
    }
  }

  async deploy(options: DeployOptions = {}): Promise<ProxyEndpoint[]> {
    const proxies = (options.options?.proxies as string[]) || this.config.proxies || [];
    const count = options.count ?? proxies.length;
    const selected = proxies.slice(0, count);

    const newEndpoints: ProxyEndpoint[] = selected.map((proxyUrl, index) => {
      const id = `anyprox-generic-${Date.now()}-${index}`;
      return {
        id,
        provider: this.name,
        url: proxyUrl,
        createdAt: new Date().toISOString(),
        status: 'active',
        metadata: { proxyUrl },
      };
    });

    this.endpoints.push(...newEndpoints);
    return newEndpoints;
  }

  async list(): Promise<ProxyEndpoint[]> {
    return this.endpoints;
  }

  async destroy(endpointIds?: string[]): Promise<void> {
    if (!endpointIds || endpointIds.length === 0) {
      this.endpoints = [];
    } else {
      const removeSet = new Set(endpointIds);
      this.endpoints = this.endpoints.filter((ep) => !removeSet.has(ep.id));
    }
  }

  async healthCheck(endpoint: ProxyEndpoint): Promise<HealthCheckResult> {
    return checkEndpointHealth(endpoint.url);
  }

  formatRequest(
    endpoint: ProxyEndpoint,
    targetUrl: string,
    init: RequestInit = {}
  ): OutgoingProxyRequest {
    const headers = sanitizeRequestHeaders(init.headers, targetUrl);

    // If generic endpoint is a reverse proxy accepting ?url=
    let proxyUrl = endpoint.url;
    if (endpoint.url.includes('?') || endpoint.url.endsWith('/')) {
      proxyUrl = `${endpoint.url}?url=${encodeURIComponent(targetUrl)}`;
    } else {
      headers['x-target-url'] = targetUrl;
    }

    return {
      url: proxyUrl,
      method: init.method || 'GET',
      headers,
      body: init.body as string | Uint8Array | ReadableStream | null,
    };
  }
}
