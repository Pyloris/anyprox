import type { ProxyEndpoint, RotationStrategy, StrategyContext } from '../../types/index.js';

export class UniqueIpStrategy implements RotationStrategy {
  readonly name = 'unique-ip';
  private lastUsedIp: string | null = null;
  private fallbackIndex = 0;

  select(endpoints: ProxyEndpoint[], _context?: StrategyContext): ProxyEndpoint | null {
    if (!endpoints || endpoints.length === 0) {
      return null;
    }

    if (endpoints.length === 1) {
      return endpoints[0];
    }

    // Attempt to find an endpoint with an egressIp different from the last used IP
    const distinctEndpoints = endpoints.filter((ep) => ep.egressIp && ep.egressIp !== this.lastUsedIp);

    let selected: ProxyEndpoint;
    if (distinctEndpoints.length > 0) {
      const randomIndex = Math.floor(Math.random() * distinctEndpoints.length);
      selected = distinctEndpoints[randomIndex];
    } else {
      // Fallback: round robin
      selected = endpoints[this.fallbackIndex % endpoints.length];
      this.fallbackIndex = (this.fallbackIndex + 1) % endpoints.length;
    }

    if (selected.egressIp) {
      this.lastUsedIp = selected.egressIp;
    }

    return selected;
  }
}
