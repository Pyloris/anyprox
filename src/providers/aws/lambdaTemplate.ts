/**
 * Node.js ES Module Lambda Proxy Router for AnyProx on AWS.
 */
export function getLambdaScript(): string {
  return `/**
 * AnyProx AWS Lambda Proxy Handler
 */
export const handler = async (event) => {
  try {
    const headers = event.headers || {};
    const queryParams = event.queryStringParameters || {};

    let targetUrl = queryParams.url || headers['x-target-url'] || headers['X-Target-URL'];

    // Support path prefix /https://target.com
    const rawPath = event.rawPath || event.path || '';
    if (!targetUrl && rawPath && rawPath !== '/') {
      const pathSub = rawPath.slice(1);
      if (pathSub.startsWith('http://') || pathSub.startsWith('https://')) {
        const rawQuery = event.rawQueryString ? '?' + event.rawQueryString : '';
        targetUrl = pathSub + rawQuery;
      }
    }

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'AnyProx AWS: No target URL specified',
          usage: {
            query_param: '?url=https://example.com',
            header: 'X-Target-URL: https://example.com'
          }
        })
      };
    }

    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const hopByHop = ['host', 'connection', 'x-target-url', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-port'];

    const forwardHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      if (!hopByHop.includes(k.toLowerCase())) {
        forwardHeaders[k] = v;
      }
    }

    // Set Host header
    try {
      const urlObj = new URL(targetUrl);
      forwardHeaders['host'] = urlObj.host;
    } catch (e) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'AnyProx AWS: Invalid target URL', targetUrl })
      };
    }

    // Optional X-Forwarded-For injection
    const customXff = headers['x-my-x-forwarded-for'] || headers['x-forwarded-for'];
    if (customXff) {
      forwardHeaders['x-forwarded-for'] = customXff;
    }

    let reqBody = undefined;
    if (!['GET', 'HEAD'].includes(method)) {
      if (event.isBase64Encoded && event.body) {
        reqBody = Buffer.from(event.body, 'base64');
      } else if (event.body) {
        reqBody = event.body;
      }
    }

    const response = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: reqBody,
      redirect: 'follow'
    });

    const resHeaders = {};
    response.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(lower)) {
        resHeaders[k] = v;
      }
    });

    // Permissive CORS
    resHeaders['access-control-allow-origin'] = '*';
    resHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD';
    resHeaders['access-control-allow-headers'] = '*';

    const arrayBuffer = await response.arrayBuffer();
    const base64Body = Buffer.from(arrayBuffer).toString('base64');

    return {
      statusCode: response.status,
      headers: resHeaders,
      body: base64Body,
      isBase64Encoded: true
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: 'AnyProx AWS: Proxy request failed',
        message: err.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
`;
}
