/**
 * AnyProx Type Definitions
 * Extensible Cloud Proxy & IP Rotation Framework
 */

export type EndpointStatus = 'deploying' | 'active' | 'degraded' | 'failed';

export interface ProxyEndpoint {
  id: string;
  provider: string;
  url: string;
  region?: string;
  egressIp?: string;
  createdAt: string; // ISO 8601 string for easy serialization
  status: EndpointStatus;
  metadata?: Record<string, unknown>;
}

export interface DeployOptions {
  count?: number;
  regions?: string[];
  namePrefix?: string;
  tags?: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  egressIp?: string;
  statusCode?: number;
  error?: string;
}

export interface OutgoingProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array | ReadableStream | null;
}

export interface StrategyContext {
  targetUrl?: string;
  method?: string;
  headers?: Record<string, string>;
  sessionId?: string;
  domain?: string;
}

export interface RotationStrategy {
  readonly name: string;
  select(endpoints: ProxyEndpoint[], context?: StrategyContext): ProxyEndpoint | null;
  recordSuccess?(endpoint: ProxyEndpoint, latencyMs?: number): void;
  recordFailure?(endpoint: ProxyEndpoint, error?: unknown): void;
}

export interface CloudflareProviderConfig {
  apiToken?: string;
  accountId?: string;
  zoneId?: string;
  customDomain?: string;
  [key: string]: unknown;
}

export interface AwsProviderConfig {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  defaultRegions?: string[];
  [key: string]: unknown;
}

export interface GenericProviderConfig {
  proxies: string[];
  [key: string]: unknown;
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  cooldownSeconds?: number;
  retryOnStatus?: number[];
}

export interface PoolConfig {
  defaultCount?: number;
  strategy?: 'round-robin' | 'random' | 'least-used' | 'sticky-session' | 'region-preferred' | 'unique-ip' | string;
  healthCheckIntervalSeconds?: number;
  circuitBreaker?: CircuitBreakerConfig;
}

export interface ServerConfig {
  port?: number;
  host?: string;
}

export interface AnyProxConfig {
  $schema?: string;
  defaultProvider?: 'cloudflare' | 'aws' | 'generic' | string;
  providers?: {
    cloudflare?: CloudflareProviderConfig;
    aws?: AwsProviderConfig;
    generic?: GenericProviderConfig;
    [customProvider: string]: unknown;
  };
  pool?: PoolConfig;
  server?: ServerConfig;
  stateStore?: 'file' | 'memory' | string;
}

export interface AnyProxOptions {
  config?: AnyProxConfig;
  configPath?: string;
  autoInit?: boolean;
}

export interface RequestRotationOptions {
  strategy?: string;
  retryOnRateLimit?: boolean;
  maxRetries?: number;
  preferredRegion?: string;
  sessionId?: string;
}

export interface AnyProxRequestInit extends RequestInit {
  rotation?: RequestRotationOptions;
}

export interface ProxyProvider {
  readonly name: string;
  init(config?: Record<string, unknown>): Promise<void>;
  deploy(options: DeployOptions): Promise<ProxyEndpoint[]>;
  list(): Promise<ProxyEndpoint[]>;
  destroy(endpointIds?: string[]): Promise<void>;
  healthCheck(endpoint: ProxyEndpoint): Promise<HealthCheckResult>;
  formatRequest(endpoint: ProxyEndpoint, targetUrl: string, init?: RequestInit): OutgoingProxyRequest;
}
