import type { ProxyEndpoint, RotationStrategy, StrategyContext } from '../../types/index.js';

export class LeastUsedStrategy implements RotationStrategy {
  readonly name = 'least-used';
  private inFlightMap = new Map<string, number>();

  select(endpoints: ProxyEndpoint[], _context?: StrategyContext): ProxyEndpoint | null {
    if (!endpoints || endpoints.length === 0) {
      return null;
    }

    let minEndpoint: ProxyEndpoint = endpoints[0];
    let minInFlight = this.inFlightMap.get(minEndpoint.id) ?? 0;

    for (let i = 1; i < endpoints.length; i++) {
      const ep = endpoints[i];
      const inFlight = this.inFlightMap.get(ep.id) ?? 0;
      if (inFlight < minInFlight) {
        minEndpoint = ep;
        minInFlight = inFlight;
      }
    }

    // Increment in-flight usage
    this.inFlightMap.set(minEndpoint.id, minInFlight + 1);
    return minEndpoint;
  }

  recordSuccess(endpoint: ProxyEndpoint): void {
    const current = this.inFlightMap.get(endpoint.id) ?? 1;
    this.inFlightMap.set(endpoint.id, Math.max(0, current - 1));
  }

  recordFailure(endpoint: ProxyEndpoint): void {
    const current = this.inFlightMap.get(endpoint.id) ?? 1;
    this.inFlightMap.set(endpoint.id, Math.max(0, current - 1));
  }
}
