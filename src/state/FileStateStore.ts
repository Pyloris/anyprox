import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProxyEndpoint } from '../types/index.js';
import type { StateStore } from './StateStore.js';

/**
 * File-based persistent state store with atomic write guarantees.
 * Saves state to a JSON file (defaults to .anyprox/state.json).
 */
export class FileStateStore implements StateStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), '.anyprox', 'state.json');
  }

  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async load(): Promise<ProxyEndpoint[]> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async save(endpoints: ProxyEndpoint[]): Promise<void> {
    await this.ensureDir();
    const tempPath = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const content = JSON.stringify(endpoints, null, 2);
    
    // Write to temporary file first, then atomically rename
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, this.filePath);
  }

  async upsert(endpoints: ProxyEndpoint[]): Promise<void> {
    const current = await this.load();
    const map = new Map<string, ProxyEndpoint>(current.map((ep) => [ep.id, ep]));
    
    for (const ep of endpoints) {
      map.set(ep.id, ep);
    }
    
    await this.save(Array.from(map.values()));
  }

  async remove(endpointIds: string[]): Promise<void> {
    const current = await this.load();
    const removeSet = new Set(endpointIds);
    const updated = current.filter((ep) => !removeSet.has(ep.id));
    await this.save(updated);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
