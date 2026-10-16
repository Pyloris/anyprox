import { describe, it, expect } from 'vitest';
import { sanitizeRequestHeaders, generateRandomPublicIp } from '../src/utils/headerSanitizer.js';

describe('Header Sanitizer & IP Utilities', () => {
  it('should strip hop-by-hop headers and keep standard headers', () => {
    const input = {
      'content-type': 'application/json',
      'authorization': 'Bearer token123',
      'connection': 'keep-alive',
      'transfer-encoding': 'chunked',
    };

    const sanitized = sanitizeRequestHeaders(input, 'https://api.example.com/data');

    expect(sanitized['content-type']).toBe('application/json');
    expect(sanitized['authorization']).toBe('Bearer token123');
    expect(sanitized['host']).toBe('api.example.com');
    expect(sanitized['connection']).toBeUndefined();
    expect(sanitized['transfer-encoding']).toBeUndefined();
  });

  it('should generate valid random public IP address', () => {
    const ip = generateRandomPublicIp();
    const parts = ip.split('.').map(Number);

    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part).toBeGreaterThanOrEqual(1);
      expect(part).toBeLessThanOrEqual(255);
    }
  });
});
