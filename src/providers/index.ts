import type { ProxyProvider } from '../types/index.js';
import { CloudflareProvider } from './cloudflare/CloudflareProvider.js';
import { AwsProvider } from './aws/AwsProvider.js';
import { GenericProxyProvider } from './generic/GenericProxyProvider.js';

export { CloudflareProvider, AwsProvider, GenericProxyProvider };

export class ProviderRegistry {
  private providers = new Map<string, ProxyProvider>();

  constructor() {
    this.register(new CloudflareProvider());
    this.register(new AwsProvider());
    this.register(new GenericProxyProvider());
  }

  register(provider: ProxyProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  get(name: string): ProxyProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.providers.has(name.toLowerCase());
  }

  list(): ProxyProvider[] {
    return Array.from(this.providers.values());
  }
}
