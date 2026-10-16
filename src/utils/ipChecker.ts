import type { HealthCheckResult } from '../types/index.js';

const IP_SERVICES = [
  'https://httpbin.org/ip',
  'https://api.ipify.org?format=json',
  'https://ifconfig.me/ip',
];

/**
 * Checks an endpoint's health and extracts its egress IP address.
 * Can be called through a proxy endpoint URL format (e.g. `${endpointUrl}?url=...`)
 * or with custom headers.
 */
export async function checkEndpointHealth(
  targetProbeUrl: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15000
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(targetProbeUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AnyProx-HealthChecker/1.0',
        Accept: 'application/json, text/plain, */*',
      },
    });

    const latencyMs = Date.now() - startTime;
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        healthy: false,
        latencyMs,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const text = await response.text();
    let egressIp: string | undefined;

    // Try parsing as JSON first (httpbin.org or api.ipify.org)
    try {
      const data = JSON.parse(text);
      if (typeof data.origin === 'string') {
        // httpbin format "ip1, ip2"
        egressIp = data.origin.split(',')[0].trim();
      } else if (typeof data.ip === 'string') {
        egressIp = data.ip.trim();
      }
    } catch {
      // Plain text IP format (ifconfig.me)
      const trimmed = text.trim();
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) {
        egressIp = trimmed;
      }
    }

    return {
      healthy: true,
      latencyMs,
      statusCode: response.status,
      egressIp,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    const isTimeout = (err as Error).name === 'AbortError';

    return {
      healthy: false,
      latencyMs,
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : (err as Error).message,
    };
  }
}

export { IP_SERVICES };
