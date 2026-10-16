import { describe, it, expect } from 'vitest';
import {
  RoundRobinStrategy,
  RandomStrategy,
  LeastUsedStrategy,
  StickySessionStrategy,
  UniqueIpStrategy,
  createStrategy,
} from '../src/core/strategies/index.js';
import type { ProxyEndpoint } from '../src/types/index.js';

const mockEndpoints: ProxyEndpoint[] = [
  {
    id: 'ep-1',
    provider: 'cloudflare',
    url: 'https://ep1.workers.dev',
    createdAt: new Date().toISOString(),
    status: 'active',
    egressIp: '1.1.1.1',
  },
  {
    id: 'ep-2',
    provider: 'cloudflare',
    url: 'https://ep2.workers.dev',
    createdAt: new Date().toISOString(),
    status: 'active',
    egressIp: '2.2.2.2',
  },
  {
    id: 'ep-3',
    provider: 'aws',
    url: 'https://ep3.on.aws',
    createdAt: new Date().toISOString(),
    status: 'active',
    egressIp: '3.3.3.3',
  },
];

describe('Rotation Strategies', () => {
  describe('RoundRobinStrategy', () => {
    it('should cycle through endpoints sequentially', () => {
      const strategy = new RoundRobinStrategy();

      expect(strategy.select(mockEndpoints)?.id).toBe('ep-1');
      expect(strategy.select(mockEndpoints)?.id).toBe('ep-2');
      expect(strategy.select(mockEndpoints)?.id).toBe('ep-3');
      expect(strategy.select(mockEndpoints)?.id).toBe('ep-1'); // Wrap-around
    });

    it('should return null for empty endpoints', () => {
      const strategy = new RoundRobinStrategy();
      expect(strategy.select([])).toBeNull();
    });
  });

  describe('RandomStrategy', () => {
    it('should select an endpoint from the pool', () => {
      const strategy = new RandomStrategy();
      const selected = strategy.select(mockEndpoints);
      expect(selected).not.toBeNull();
      expect(mockEndpoints.map((e) => e.id)).toContain(selected?.id);
    });
  });

  describe('LeastUsedStrategy', () => {
    it('should pick endpoint with least in-flight requests', () => {
      const strategy = new LeastUsedStrategy();

      // First selection: ep-1 (all at 0)
      const first = strategy.select(mockEndpoints);
      expect(first?.id).toBe('ep-1');

      // Second selection: ep-2 (ep-1 is at 1 in-flight)
      const second = strategy.select(mockEndpoints);
      expect(second?.id).toBe('ep-2');

      // Release ep-1
      if (first) strategy.recordSuccess(first);

      // Third selection: ep-1 is back at 0, should be selected again
      const third = strategy.select(mockEndpoints);
      expect(third?.id).toBe('ep-1');
    });
  });

  describe('StickySessionStrategy', () => {
    it('should consistently route same session to same endpoint', () => {
      const strategy = new StickySessionStrategy();

      const select1 = strategy.select(mockEndpoints, { sessionId: 'user-session-abc' });
      const select2 = strategy.select(mockEndpoints, { sessionId: 'user-session-abc' });
      const select3 = strategy.select(mockEndpoints, { sessionId: 'user-session-abc' });

      expect(select1?.id).toBe(select2?.id);
      expect(select2?.id).toBe(select3?.id);
    });

    it('should consistently route by domain if no session provided', () => {
      const strategy = new StickySessionStrategy();

      const select1 = strategy.select(mockEndpoints, { domain: 'target-api.com' });
      const select2 = strategy.select(mockEndpoints, { domain: 'target-api.com' });

      expect(select1?.id).toBe(select2?.id);
    });
  });

  describe('UniqueIpStrategy', () => {
    it('should rotate through different egress IPs', () => {
      const strategy = new UniqueIpStrategy();

      const first = strategy.select(mockEndpoints);
      const second = strategy.select(mockEndpoints);

      expect(first?.egressIp).not.toBe(second?.egressIp);
    });
  });

  describe('createStrategy factory', () => {
    it('should create strategies by name', () => {
      expect(createStrategy('round-robin').name).toBe('round-robin');
      expect(createStrategy('random').name).toBe('random');
      expect(createStrategy('least-used').name).toBe('least-used');
      expect(createStrategy('sticky-session').name).toBe('sticky-session');
      expect(createStrategy('unique-ip').name).toBe('unique-ip');
    });
  });
});
