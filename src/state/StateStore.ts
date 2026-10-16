import type { ProxyEndpoint } from '../types/index.js';

export interface StateStore {
  /** Load all saved proxy endpoints */
  load(): Promise<ProxyEndpoint[]>;

  /** Save all active proxy endpoints */
  save(endpoints: ProxyEndpoint[]): Promise<void>;

  /** Add or update specific endpoints */
  upsert(endpoints: ProxyEndpoint[]): Promise<void>;

  /** Remove endpoints by ID */
  remove(endpointIds: string[]): Promise<void>;

  /** Clear all state */
  clear(): Promise<void>;
}
