import { describe, it, expect } from 'vitest';
import { loadConfig, resolveEnvString } from '../src/utils/configLoader.js';

describe('Configuration Loader', () => {
  it('should resolve env: variables correctly', () => {
    process.env.TEST_ANYPROX_KEY = 'secret-123';

    expect(resolveEnvString('env:TEST_ANYPROX_KEY')).toBe('secret-123');
    expect(resolveEnvString('regular-value')).toBe('regular-value');
    expect(resolveEnvString({ key: 'env:TEST_ANYPROX_KEY' })).toEqual({ key: 'secret-123' });

    delete process.env.TEST_ANYPROX_KEY;
  });

  it('should accept direct JSON config object without files', () => {
    const config = loadConfig({
      config: {
        defaultProvider: 'aws',
        providers: {
          aws: {
            accessKeyId: 'MY_KEY',
            secretAccessKey: 'MY_SECRET',
          },
        },
        pool: {
          defaultCount: 5,
          strategy: 'least-used',
        },
      },
    });

    expect(config.defaultProvider).toBe('aws');
    expect(config.providers?.aws?.accessKeyId).toBe('MY_KEY');
    expect(config.pool?.defaultCount).toBe(5);
    expect(config.pool?.strategy).toBe('least-used');
  });
});
