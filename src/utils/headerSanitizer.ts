/**
 * Header normalization and sanitization utilities for AnyProx.
 */

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export type RequestHeaderInput =
  | Headers
  | Record<string, unknown>
  | [string, string][]
  | string[][]
  | Iterable<[string, string]>;

export function sanitizeRequestHeaders(
  inputHeaders?: RequestHeaderInput,
  targetUrl?: string,
  spoofXForwardedFor = false
): Record<string, string> {
  const result: Record<string, string> = {};

  if (!inputHeaders) {
    if (targetUrl) {
      result['host'] = new URL(targetUrl).host;
    }
    return result;
  }

  if (inputHeaders instanceof Headers) {
    inputHeaders.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP_HEADERS.has(lower)) {
        result[lower] = value;
      }
    });
  } else if (Array.isArray(inputHeaders)) {
    for (const entry of inputHeaders) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const [key, value] = entry;
        const lower = key.toLowerCase();
        if (!HOP_BY_HOP_HEADERS.has(lower)) {
          result[lower] = String(value);
        }
      }
    }
  } else {
    for (const [key, value] of Object.entries(inputHeaders)) {
      if (value !== undefined) {
        const lower = key.toLowerCase();
        if (!HOP_BY_HOP_HEADERS.has(lower)) {
          result[lower] = Array.isArray(value) ? value.join(', ') : String(value);
        }
      }
    }
  }

  // Set host header based on target URL if provided
  if (targetUrl) {
    try {
      result['host'] = new URL(targetUrl).host;
    } catch {
      // Ignore if invalid URL
    }
  }

  // Optional X-Forwarded-For random IP generation if none provided
  if (spoofXForwardedFor && !result['x-forwarded-for']) {
    result['x-forwarded-for'] = generateRandomPublicIp();
  }

  return result;
}

export function generateRandomPublicIp(): string {
  // Generate random IP avoiding private/reserved ranges
  const octet1 = Math.floor(Math.random() * 200) + 11;
  const octet2 = Math.floor(Math.random() * 254) + 1;
  const octet3 = Math.floor(Math.random() * 254) + 1;
  const octet4 = Math.floor(Math.random() * 254) + 1;
  return `${octet1}.${octet2}.${octet3}.${octet4}`;
}
