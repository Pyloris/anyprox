import type { ProxyEndpoint, RotationStrategy, StrategyContext } from '../../types/index.js';

export class RoundRobinStrategy implements RotationStrategy {
  readonly name = 'round-robin';
  private index = 0;

  select(endpoints: ProxyEndpoint[], _context?: StrategyContext): ProxyEndpoint | null {
    if (!endpoints || endpoints.length === 0) {
      return null;
    }

    const selected = endpoints[this.index % endpoints.length];
    this.index = (this.index + 1) % endpoints.length;
    return selected;
  }
}
