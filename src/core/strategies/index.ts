import type { RotationStrategy } from '../../types/index.js';
import { RoundRobinStrategy } from './RoundRobinStrategy.js';
import { RandomStrategy } from './RandomStrategy.js';
import { LeastUsedStrategy } from './LeastUsedStrategy.js';
import { StickySessionStrategy } from './StickySessionStrategy.js';
import { UniqueIpStrategy } from './UniqueIpStrategy.js';

export {
  RoundRobinStrategy,
  RandomStrategy,
  LeastUsedStrategy,
  StickySessionStrategy,
  UniqueIpStrategy,
};

export function createStrategy(name: string = 'round-robin'): RotationStrategy {
  switch (name.toLowerCase()) {
    case 'round-robin':
    case 'roundrobin':
      return new RoundRobinStrategy();
    case 'random':
      return new RandomStrategy();
    case 'least-used':
    case 'leastused':
      return new LeastUsedStrategy();
    case 'sticky-session':
    case 'stickysession':
    case 'sticky':
      return new StickySessionStrategy();
    case 'unique-ip':
    case 'uniqueip':
      return new UniqueIpStrategy();
    default:
      return new RoundRobinStrategy();
  }
}
