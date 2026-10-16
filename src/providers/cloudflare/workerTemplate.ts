/**
 * Generates the modern ES Module Cloudflare Worker proxy script.
 */
export function getWorkerScript(): string {
  return `/**
 * AnyProx - Modern Cloudflare Worker URL Redirection Script
 */
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      let targetUrl = url.searchParams.get('url') || request.headers.get('X-Target-URL');

      if (!targetUrl && url.pathname !== '/') {
        const pathSub = url.pathname.slice(1);
        if (pathSub.startsWith('http://') || pathSub.startsWith('https://')) {
          targetUrl = pathSub + url.search;
        }
      }

      if (!targetUrl) {
        return new Response(JSON.stringify({
          error: 'AnyProx: No target URL specified',
          usage: {
            query_param: '?url=https://example.com',
            header: 'X-Target-URL: https://example.com',
            path: '/https://example.com'
          }
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      let targetObj;
      try {
        targetObj = new URL(targetUrl);
      } catch (e) {
        return new Response(JSON.stringify({
          error: 'AnyProx: Invalid target URL',
          provided: targetUrl
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Preserve extra query parameters from worker URL into target URL
      for (const [key, val] of url.searchParams) {
        if (!['url', '_cb', '_t'].includes(key) && !targetObj.searchParams.has(key)) {
          targetObj.searchParams.append(key, val);
        }
      }

      // Filter and forward headers
      const forwardedHeaders = new Headers();
      const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

      for (const [key, value] of request.headers) {
        const lower = key.toLowerCase();
        if (!HOP_BY_HOP.includes(lower) && lower !== 'x-target-url') {
          forwardedHeaders.set(key, value);
        }
      }

      // Set Host header to destination hostname
      forwardedHeaders.set('Host', targetObj.hostname);

      // Support custom or spoofed X-Forwarded-For
      const customXff = request.headers.get('X-My-X-Forwarded-For') || request.headers.get('X-Forwarded-For');
      if (customXff) {
        forwardedHeaders.set('X-Forwarded-For', customXff);
      }

      const isBodyAllowed = !['GET', 'HEAD'].includes(request.method);
      const proxyReq = new Request(targetObj.toString(), {
        method: request.method,
        headers: forwardedHeaders,
        body: isBodyAllowed ? request.body : null,
        redirect: 'follow'
      });

      const response = await fetch(proxyReq);

      // Prepare response headers, stripping hop-by-hop and encoding headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('content-length');
      responseHeaders.delete('transfer-encoding');

      // CORS headers for browser compatibility
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
      responseHeaders.set('Access-Control-Allow-Headers', '*');

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: responseHeaders });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({
        error: 'AnyProx: Proxy request failed',
        message: err.message,
        timestamp: new Date().toISOString()
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
`;
}
