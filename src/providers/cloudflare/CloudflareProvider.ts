import type {
  CloudflareProviderConfig,
  DeployOptions,
  HealthCheckResult,
  OutgoingProxyRequest,
  ProxyEndpoint,
  ProxyProvider,
} from '../../types/index.js';
import { CloudflareApiClient } from './cfApiClient.js';
import { getWorkerScript } from './workerTemplate.js';
import { checkEndpointHealth } from '../../utils/ipChecker.js';
import { sanitizeRequestHeaders } from '../../utils/headerSanitizer.js';

export class CloudflareProvider implements ProxyProvider {
  readonly name = 'cloudflare';
  private client: CloudflareApiClient | null = null;
  private config: CloudflareProviderConfig = {};

  constructor(config?: CloudflareProviderConfig) {
    if (config) {
      this.config = config;
      if (config.apiToken && config.accountId) {
        this.client = new CloudflareApiClient(config.apiToken, config.accountId);
      }
    }
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...(config as CloudflareProviderConfig) };
    }

    const apiToken = this.config.apiToken || process.env.CF_API_TOKEN;
    const accountId = this.config.accountId || process.env.CF_ACCOUNT_ID;

    if (!apiToken || !accountId) {
      throw new Error(
        'CloudflareProvider requires both apiToken and accountId. ' +
        'Set them in configuration or via CF_API_TOKEN and CF_ACCOUNT_ID environment variables.'
      );
    }

    this.client = new CloudflareApiClient(apiToken, accountId);
  }

  private ensureClient(): CloudflareApiClient {
    if (!this.client) {
      throw new Error('CloudflareProvider not initialized. Call init() first.');
    }
    return this.client;
  }

  async deploy(options: DeployOptions = {}): Promise<ProxyEndpoint[]> {
    const client = this.ensureClient();
    const count = options.count ?? 1;
    const prefix = options.namePrefix ?? 'anyprox-cf';
    const subdomain = await client.getOrProvisionSubdomain();
    const scriptContent = getWorkerScript();

    const deployPromises = Array.from({ length: count }, async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const workerName = `${prefix}-${timestamp}-${randomSuffix}`;

      // Upload worker script
      await client.uploadWorkerScript(workerName, scriptContent);

      // Enable on workers.dev subdomain
      await client.enableWorkerSubdomain(workerName);

      const workerUrl = `https://${workerName}.${subdomain}.workers.dev`;

      const endpoint: ProxyEndpoint = {
        id: workerName,
        provider: this.name,
        url: workerUrl,
        region: 'global',
        createdAt: new Date().toISOString(),
        status: 'active',
        metadata: {
          subdomain,
          scriptName: workerName,
        },
      };

      return endpoint;
    });

    return Promise.all(deployPromises);
  }

  async list(): Promise<ProxyEndpoint[]> {
    const client = this.ensureClient();
    const subdomain = await client.getOrProvisionSubdomain();
    const scripts = await client.listWorkers();

    const anyproxEndpoints: ProxyEndpoint[] = [];
    for (const script of scripts) {
      // Support anyprox and legacy flareprox workers
      if (script.id.startsWith('anyprox-cf-') || script.id.startsWith('flareprox-')) {
        anyproxEndpoints.push({
          id: script.id,
          provider: this.name,
          url: `https://${script.id}.${subdomain}.workers.dev`,
          region: 'global',
          createdAt: script.created_on || new Date().toISOString(),
          status: 'active',
          metadata: {
            subdomain,
            scriptName: script.id,
          },
        });
      }
    }

    return anyproxEndpoints;
  }

  async destroy(endpointIds?: string[]): Promise<void> {
    const client = this.ensureClient();
    let toDelete = endpointIds;

    if (!toDelete || toDelete.length === 0) {
      const active = await this.list();
      toDelete = active.map((ep) => ep.id);
    }

    await Promise.all(toDelete.map((id) => client.deleteWorker(id)));
  }

  async healthCheck(endpoint: ProxyEndpoint): Promise<HealthCheckResult> {
    const probeUrl = `${endpoint.url}?url=https://httpbin.org/ip`;
    return checkEndpointHealth(probeUrl);
  }

  formatRequest(
    endpoint: ProxyEndpoint,
    targetUrl: string,
    init: RequestInit = {}
  ): OutgoingProxyRequest {
    // Send target URL via X-Target-URL header and rewrite request
    const headers = sanitizeRequestHeaders(init.headers, targetUrl);
    headers['x-target-url'] = targetUrl;

    return {
      url: endpoint.url,
      method: init.method || 'GET',
      headers,
      body: init.body as string | Uint8Array | ReadableStream | null,
    };
  }
}
