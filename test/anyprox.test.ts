import { describe, it, expect, vi } from 'vitest';
import { AnyProx } from '../src/core/AnyProx.js';
import type {
  DeployOptions,
  HealthCheckResult,
  OutgoingProxyRequest,
  ProxyEndpoint,
  ProxyProvider,
} from '../src/types/index.js';

class MockTestProvider implements ProxyProvider {
  readonly name = 'mock-provider';

  async init(): Promise<void> {}

  async deploy(options: DeployOptions): Promise<ProxyEndpoint[]> {
    const count = options.count ?? 1;
    return Array.from({ length: count }, (_, i) => ({
      id: `mock-node-${i + 1}`,
      provider: this.name,
      url: `https://mock-${i + 1}.test.local`,
      createdAt: new Date().toISOString(),
      status: 'active',
      egressIp: `198.51.100.${i + 1}`,
    }));
  }

  async list(): Promise<ProxyEndpoint[]> {
    return [];
  }

  async destroy(): Promise<void> {}

  async healthCheck(endpoint: ProxyEndpoint): Promise<HealthCheckResult> {
    return {
      healthy: true,
      latencyMs: 42,
      egressIp: endpoint.egressIp,
      statusCode: 200,
    };
  }

  formatRequest(endpoint: ProxyEndpoint, targetUrl: string, init: RequestInit = {}): OutgoingProxyRequest {
    return {
      url: `${endpoint.url}?url=${encodeURIComponent(targetUrl)}`,
      method: init.method || 'GET',
      headers: { ...(init.headers as Record<string, string>), 'x-target-url': targetUrl },
      body: null,
    };
  }
}

describe('AnyProx Orchestrator & Client Integration', () => {
  it('should initialize with in-memory store and register custom provider', async () => {
    const anyprox = new AnyProx({
      config: {
        stateStore: 'memory',
        defaultProvider: 'mock-provider',
        pool: {
          strategy: 'round-robin',
        },
      },
    });

    const mockProvider = new MockTestProvider();
    anyprox.registerProvider(mockProvider);
    await anyprox.init();

    expect(anyprox.providers.has('mock-provider')).toBe(true);

    // Deploy 2 endpoints
    const deployed = await anyprox.deploy({ count: 2 });
    expect(deployed).toHaveLength(2);
    expect(deployed[0].id).toBe('mock-node-1');
    expect(deployed[1].id).toBe('mock-node-2');

    // List pool endpoints
    const list = await anyprox.list();
    expect(list).toHaveLength(2);

    // Run health check
    const testResults = await anyprox.test();
    expect(testResults).toHaveLength(2);
    expect(testResults[0].health.healthy).toBe(true);
    expect(testResults[0].health.egressIp).toBe('198.51.100.1');

    // Agents and Dispatcher creation
    const httpAgent = anyprox.createHttpAgent();
    expect(httpAgent).toBeDefined();

    const httpsAgent = anyprox.createHttpsAgent();
    expect(httpsAgent).toBeDefined();

    const dispatcher = anyprox.createDispatcher();
    expect(dispatcher).toBeDefined();
  });

  it('should route requests and rotate through deployed endpoints', async () => {
    const anyprox = new AnyProx({
      config: {
        stateStore: 'memory',
        defaultProvider: 'mock-provider',
      },
    });

    const mockProvider = new MockTestProvider();
    anyprox.registerProvider(mockProvider);
    await anyprox.init();
    await anyprox.deploy({ count: 2 });

    const calledUrls: string[] = [];
    const globalFetch = vi.fn().mockImplementation(async (url: string) => {
      calledUrls.push(url);
      return new Response(JSON.stringify({ success: true, url }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', globalFetch);

    const res1 = await anyprox.fetch('https://target.com/api/v1');
    expect(res1.status).toBe(200);

    const res2 = await anyprox.fetch('https://target.com/api/v2');
    expect(res2.status).toBe(200);

    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toContain('https://mock-1.test.local?url=https%3A%2F%2Ftarget.com%2Fapi%2Fv1');
    expect(calledUrls[1]).toContain('https://mock-2.test.local?url=https%3A%2F%2Ftarget.com%2Fapi%2Fv2');

    vi.unstubAllGlobals();
  });
});
