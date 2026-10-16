/**
 * AnyProx - Extensible Cloud Proxy & IP Rotation Framework for Node.js
 */

export { AnyProx } from './core/AnyProx.js';
export { ProxyPool, type ProxyPoolOptions } from './core/ProxyPool.js';

// Providers
export {
  ProviderRegistry,
  CloudflareProvider,
  AwsProvider,
  GenericProxyProvider,
} from './providers/index.js';

// Strategies
export {
  createStrategy,
  RoundRobinStrategy,
  RandomStrategy,
  LeastUsedStrategy,
  StickySessionStrategy,
  UniqueIpStrategy,
} from './core/strategies/index.js';

// Client & Transport Adapters
export { AnyProxClient, type AnyProxClientOptions } from './client/AnyProxClient.js';
export { AnyProxHttpAgent, AnyProxHttpsAgent, type AnyProxAgentOptions } from './client/AnyProxHttpAgent.js';
export { AnyProxDispatcher, type AnyProxDispatcherOptions } from './client/AnyProxDispatcher.js';

// Server
export { ProxyServer, type ProxyServerOptions } from './server/ProxyServer.js';

// State Persistence
export { type StateStore } from './state/StateStore.js';
export { FileStateStore } from './state/FileStateStore.js';
export { MemoryStateStore } from './state/MemoryStateStore.js';

// Utilities
export { checkEndpointHealth, IP_SERVICES } from './utils/ipChecker.js';
export { sanitizeRequestHeaders, generateRandomPublicIp } from './utils/headerSanitizer.js';
export { loadConfig, resolveEnvString } from './utils/configLoader.js';
export { logger, Logger, type LogLevel } from './utils/logger.js';

// Types
export type * from './types/index.js';
