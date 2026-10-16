import { describe, it, expect } from 'vitest';
import { ProxyPool } from '../src/core/ProxyPool.js';
import { MemoryStateStore } from '../src/state/MemoryStateStore.js';
import type { ProxyEndpoint } from '../src/types/index.js';

describe('ProxyPool & Circuit Breaker', () => {
  it('should add, list, and remove endpoints', async () => {
    const store = new MemoryStateStore();
    const pool = new ProxyPool({ stateStore: store });

    const ep1: ProxyEndpoint = {
      id: 'worker-1',
      provider: 'cloudflare',
      url: 'https://w1.workers.dev',
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await pool.addEndpoints([ep1]);
    expect(pool.size).toBe(1);
    expect(pool.getActiveEndpoints()).toHaveLength(1);

    await pool.removeEndpoints(['worker-1']);
    expect(pool.size).toBe(0);
  });

  it('should trip circuit breaker to degraded status after failure threshold', async () => {
    const pool = new ProxyPool({
      circuitBreaker: {
        failureThreshold: 2,
        cooldownSeconds: 1, // 1 second for fast test
        retryOnStatus: [429, 502],
      },
    });

    const ep: ProxyEndpoint = {
      id: 'test-node',
      provider: 'cloudflare',
      url: 'https://test.workers.dev',
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await pool.addEndpoints([ep]);
    expect(pool.getActiveEndpoints()).toHaveLength(1);

    // First failure: still active
    pool.recordFailure('test-node', 429);
    expect(pool.getActiveEndpoints()).toHaveLength(1);

    // Second failure: reaches threshold 2 -> trips to degraded
    pool.recordFailure('test-node', 429);
    expect(pool.getActiveEndpoints()).toHaveLength(0); // Excluded from active rotation

    // Wait 1.1s for cooldown to elapse
    await new Promise((r) => setTimeout(r, 1100));

    // Endpoint should auto-recover to active
    expect(pool.getActiveEndpoints()).toHaveLength(1);
    expect(pool.getActiveEndpoints()[0].status).toBe('active');
  });

  it('should not trip circuit breaker for non-matching status codes', async () => {
    const pool = new ProxyPool({
      circuitBreaker: {
        failureThreshold: 2,
        retryOnStatus: [429],
      },
    });

    const ep: ProxyEndpoint = {
      id: 'test-node-2',
      provider: 'cloudflare',
      url: 'https://test2.workers.dev',
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    await pool.addEndpoints([ep]);

    // 404 is not in retryOnStatus
    pool.recordFailure('test-node-2', 404);
    pool.recordFailure('test-node-2', 404);
    pool.recordFailure('test-node-2', 404);

    expect(pool.getActiveEndpoints()).toHaveLength(1);
  });
});
