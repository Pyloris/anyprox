import * as crypto from 'node:crypto';
import type { ProxyEndpoint, RotationStrategy, StrategyContext } from '../../types/index.js';

export class StickySessionStrategy implements RotationStrategy {
  readonly name = 'sticky-session';

  select(endpoints: ProxyEndpoint[], context?: StrategyContext): ProxyEndpoint | null {
    if (!endpoints || endpoints.length === 0) {
      return null;
    }

    const key = context?.sessionId || context?.domain || context?.targetUrl;
    if (!key) {
      return endpoints[0];
    }

    // Consistent hash modulo endpoints length
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const numericVal = parseInt(hash.slice(0, 8), 16);
    const index = numericVal % endpoints.length;

    return endpoints[index];
  }
}
