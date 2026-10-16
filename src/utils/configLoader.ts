import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AnyProxConfig, AnyProxOptions } from '../types/index.js';

const DEFAULT_CONFIG_LOCATIONS = [
  'anyprox.json',
  '.anyproxrc.json',
  '.anyprox.json',
  path.join(os.homedir(), '.anyprox.json'),
];

export function resolveEnvString(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env:')) {
    const envVarName = value.slice(4).trim();
    return process.env[envVarName] ?? '';
  }
  if (Array.isArray(value)) {
    return value.map(resolveEnvString);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveEnvString(v);
    }
    return result;
  }
  return value;
}

export function loadConfig(options?: AnyProxOptions): AnyProxConfig {
  let fileConfig: Partial<AnyProxConfig> = {};

  // 1. Try explicit configPath
  if (options?.configPath && fs.existsSync(options.configPath)) {
    try {
      const raw = fs.readFileSync(options.configPath, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to read config file at ${options.configPath}: ${(err as Error).message}`);
    }
  } else if (!options?.config) {
    // 2. Check default locations if no direct config provided
    for (const loc of DEFAULT_CONFIG_LOCATIONS) {
      if (fs.existsSync(loc)) {
        try {
          const raw = fs.readFileSync(loc, 'utf-8');
          fileConfig = JSON.parse(raw);
          break;
        } catch {
          // Continue to next location
        }
      }
    }
  }

  // 3. Merge direct constructor config over file config
  const merged: AnyProxConfig = {
    ...fileConfig,
    ...(options?.config ?? {}),
    providers: {
      ...(fileConfig.providers ?? {}),
      ...(options?.config?.providers ?? {}),
    },
    pool: {
      ...(fileConfig.pool ?? {}),
      ...(options?.config?.pool ?? {}),
    },
    server: {
      ...(fileConfig.server ?? {}),
      ...(options?.config?.server ?? {}),
    },
  };

  // 4. Resolve env: variables
  const resolved = resolveEnvString(merged) as AnyProxConfig;

  // 5. Fallback to process.env standard credentials if not populated
  if (!resolved.providers) {
    resolved.providers = {};
  }

  // Cloudflare env fallback
  if (!resolved.providers.cloudflare) {
    resolved.providers.cloudflare = {};
  }
  resolved.providers.cloudflare.apiToken =
    resolved.providers.cloudflare.apiToken || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  resolved.providers.cloudflare.accountId =
    resolved.providers.cloudflare.accountId || process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  resolved.providers.cloudflare.zoneId =
    resolved.providers.cloudflare.zoneId || process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID;

  // AWS env fallback
  if (!resolved.providers.aws) {
    resolved.providers.aws = {};
  }
  resolved.providers.aws.accessKeyId =
    resolved.providers.aws.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
  resolved.providers.aws.secretAccessKey =
    resolved.providers.aws.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
  resolved.providers.aws.sessionToken =
    resolved.providers.aws.sessionToken || process.env.AWS_SESSION_TOKEN;

  // Set top-level defaults
  resolved.defaultProvider = resolved.defaultProvider || 'cloudflare';
  if (!resolved.pool) {
    resolved.pool = {};
  }
  resolved.pool.defaultCount = resolved.pool.defaultCount ?? 3;
  resolved.pool.strategy = resolved.pool.strategy ?? 'round-robin';

  return resolved;
}
