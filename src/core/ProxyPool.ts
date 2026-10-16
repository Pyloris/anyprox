import type {
  CircuitBreakerConfig,
  ProxyEndpoint,
  RotationStrategy,
  StrategyContext,
} from '../types/index.js';
import type { StateStore } from '../state/StateStore.js';
import { MemoryStateStore } from '../state/MemoryStateStore.js';
import { createStrategy } from './strategies/index.js';

export interface ProxyPoolOptions {
  strategy?: string | RotationStrategy;
  circuitBreaker?: CircuitBreakerConfig;
  stateStore?: StateStore;
}

export class ProxyPool {
  private endpoints = new Map<string, ProxyEndpoint>();
  private failureCounts = new Map<string, number>();
  private cooldownUntil = new Map<string, number>();
  private strategy: RotationStrategy;
  private stateStore: StateStore;
  private circuitBreakerConfig: Required<CircuitBreakerConfig>;

  constructor(options: ProxyPoolOptions = {}) {
    if (typeof options.strategy === 'string') {
      this.strategy = createStrategy(options.strategy);
    } else if (options.strategy) {
      this.strategy = options.strategy;
    } else {
      this.strategy = createStrategy('round-robin');
    }

    this.stateStore = options.stateStore ?? new MemoryStateStore();

    this.circuitBreakerConfig = {
      failureThreshold: options.circuitBreaker?.failureThreshold ?? 3,
      cooldownSeconds: options.circuitBreaker?.cooldownSeconds ?? 60,
      retryOnStatus: options.circuitBreaker?.retryOnStatus ?? [429, 403, 502, 503, 504],
    };
  }

  /**
   * Load stored endpoints from the state store into memory.
   */
  async init(): Promise<void> {
    const loaded = await this.stateStore.load();
    for (const ep of loaded) {
      this.endpoints.set(ep.id, ep);
    }
  }

  /**
   * Set or change the rotation strategy.
   */
  setStrategy(strategy: string | RotationStrategy): void {
    if (typeof strategy === 'string') {
      this.strategy = createStrategy(strategy);
    } else {
      this.strategy = strategy;
    }
  }

  /**
   * Get the current rotation strategy name.
   */
  getStrategyName(): string {
    return this.strategy.name;
  }

  /**
   * Add new endpoints to the pool and persist to state store.
   */
  async addEndpoints(endpoints: ProxyEndpoint[]): Promise<void> {
    for (const ep of endpoints) {
      this.endpoints.set(ep.id, ep);
      this.failureCounts.delete(ep.id);
      this.cooldownUntil.delete(ep.id);
    }
    await this.stateStore.upsert(endpoints);
  }

  /**
   * Remove endpoints by ID from pool and state store.
   */
  async removeEndpoints(endpointIds: string[]): Promise<void> {
    for (const id of endpointIds) {
      this.endpoints.delete(id);
      this.failureCounts.delete(id);
      this.cooldownUntil.delete(id);
    }
    await this.stateStore.remove(endpointIds);
  }

  /**
   * Retrieve all endpoints in the pool regardless of health status.
   */
  getAllEndpoints(): ProxyEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Retrieve only healthy, active endpoints (recovering any cooled-down degraded endpoints).
   */
  getActiveEndpoints(): ProxyEndpoint[] {
    const now = Date.now();
    const active: ProxyEndpoint[] = [];

    for (const ep of this.endpoints.values()) {
      // Check if degraded endpoint has completed its cooldown
      if (ep.status === 'degraded') {
        const cooldown = this.cooldownUntil.get(ep.id) ?? 0;
        if (now >= cooldown) {
          ep.status = 'active';
          this.failureCounts.set(ep.id, 0);
          this.cooldownUntil.delete(ep.id);
        }
      }

      if (ep.status === 'active') {
        active.push(ep);
      }
    }

    return active;
  }

  /**
   * Select the next endpoint according to the active rotation strategy.
   */
  selectEndpoint(context?: StrategyContext): ProxyEndpoint | null {
    const active = this.getActiveEndpoints();
    if (active.length === 0) {
      return null;
    }
    return this.strategy.select(active, context);
  }

  /**
   * Record a successful request through an endpoint.
   */
  recordSuccess(endpointId: string, latencyMs?: number): void {
    const ep = this.endpoints.get(endpointId);
    if (!ep) return;

    this.failureCounts.set(endpointId, 0);
    this.cooldownUntil.delete(endpointId);

    if (ep.status === 'degraded') {
      ep.status = 'active';
    }

    if (this.strategy.recordSuccess) {
      this.strategy.recordSuccess(ep, latencyMs);
    }
  }

  /**
   * Record a failed request through an endpoint, checking circuit breaker threshold.
   */
  recordFailure(endpointId: string, statusCode?: number, error?: unknown): void {
    const ep = this.endpoints.get(endpointId);
    if (!ep) return;

    // Check if status code qualifies as a circuit-breaker trigger
    const isQualifyingStatus = statusCode
      ? this.circuitBreakerConfig.retryOnStatus.includes(statusCode)
      : true;

    if (!isQualifyingStatus) return;

    const currentFailures = (this.failureCounts.get(endpointId) ?? 0) + 1;
    this.failureCounts.set(endpointId, currentFailures);

    if (currentFailures >= this.circuitBreakerConfig.failureThreshold) {
      ep.status = 'degraded';
      const cooldownMs = this.circuitBreakerConfig.cooldownSeconds * 1000;
      this.cooldownUntil.set(endpointId, Date.now() + cooldownMs);
    }

    if (this.strategy.recordFailure) {
      this.strategy.recordFailure(ep, error);
    }
  }

  /**
   * Clear all endpoints from memory and state store.
   */
  async clear(): Promise<void> {
    this.endpoints.clear();
    this.failureCounts.clear();
    this.cooldownUntil.clear();
    await this.stateStore.clear();
  }

  /**
   * Total count of managed endpoints.
   */
  get size(): number {
    return this.endpoints.size;
  }
}
