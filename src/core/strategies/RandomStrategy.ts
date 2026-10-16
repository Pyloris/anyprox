import type { ProxyEndpoint, RotationStrategy, StrategyContext } from '../../types/index.js';

export class RandomStrategy implements RotationStrategy {
  readonly name = 'random';

  select(endpoints: ProxyEndpoint[], _context?: StrategyContext): ProxyEndpoint | null {
    if (!endpoints || endpoints.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * endpoints.length);
    return endpoints[randomIndex];
  }
}
