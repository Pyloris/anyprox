import type { ProxyEndpoint } from '../types/index.js';
import type { StateStore } from './StateStore.js';

/**
 * Ephemeral in-memory state store.
 * Useful for automated tests, programmatic transient tasks, or ephemeral container execution.
 */
export class MemoryStateStore implements StateStore {
  private endpoints: Map<string, ProxyEndpoint> = new Map();

  async load(): Promise<ProxyEndpoint[]> {
    return Array.from(this.endpoints.values());
  }

  async save(endpoints: ProxyEndpoint[]): Promise<void> {
    this.endpoints.clear();
    for (const ep of endpoints) {
      this.endpoints.set(ep.id, { ...ep });
    }
  }

  async upsert(endpoints: ProxyEndpoint[]): Promise<void> {
    for (const ep of endpoints) {
      this.endpoints.set(ep.id, { ...ep });
    }
  }

  async remove(endpointIds: string[]): Promise<void> {
    for (const id of endpointIds) {
      this.endpoints.delete(id);
    }
  }

  async clear(): Promise<void> {
    this.endpoints.clear();
  }
}
