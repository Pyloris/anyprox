# AnyProx ⚡

**Extensible Cloud Proxy & IP Rotation Framework for Node.js & TypeScript**

AnyProx deploys, orchestrates, and routes outbound HTTP/S traffic through ephemeral cloud infrastructure (Cloudflare Workers, AWS API Gateway + Lambda across multiple regions, or generic/SOCKS5 proxies) to provide high-diversity IP rotation for security scanning, reconnaissance, web scraping, and resilience testing.

![AnyProx Illustration](assets/illustration.png)

---

## Features

- **Multi-Cloud Provider Abstraction**:
  - **Cloudflare Workers**: Deploy lightweight edge reverse proxies on Cloudflare's global CDN (100k free requests/day).
  - **AWS API Gateway + Lambda**: Multi-region deployment (`us-east-1`, `us-west-2`, `eu-west-1`, `ap-southeast-1`, etc.) routing through Amazon's expansive global egress IP blocks.
  - **Generic / Custom Providers**: Easily incorporate external HTTP, HTTPS, or SOCKS5 proxies into the same rotation pool.
- **Direct In-Memory & File Configuration**: Configure via raw JSON objects in memory, configuration files (`anyprox.json`), or environment variables.
- **Drop-in HTTP Client & Agent Adapters**:
  - Native `http.Agent` & `https.Agent` for **Axios**, **Got**, and `node:http`.
  - Undici `Dispatcher` for modern Node.js **native `fetch`**.
  - High-level `anyprox.fetch()`, `anyprox.get()`, `anyprox.post()`.
- **Local Forward Proxy Daemon (`anyprox serve`)**:
  - Run a local HTTP proxy listener (`http://127.0.0.1:8080`) supporting HTTP and HTTPS `CONNECT` tunneling.
  - Zero-code integration with **Burp Suite**, **OWASP ZAP**, **Nuclei**, **ffuf**, **sqlmap**, or **curl**.
- **Smart Rotation & Resilience**:
  - Rotation strategies: `round-robin`, `random`, `least-used`, `sticky-session`, `unique-ip`.
  - Automated circuit breaker: trips endpoints to `degraded` cooldown on `429 Too Many Requests`, `403 Forbidden` WAF blocks, or timeouts, and reroutes traffic to healthy nodes.
  - Egress IP detection, latency measurement, and duplicate IP warnings.

---

## Installation

```bash
npm install anyprox
```

---

## Quick Start (Programmatic Usage)

### 1. In-Memory Direct JSON Configuration

```typescript
import { AnyProx } from 'anyprox';

// Initialize with direct JSON configuration (no files needed)
const anyprox = new AnyProx({
  config: {
    defaultProvider: 'cloudflare',
    providers: {
      cloudflare: {
        apiToken: process.env.CF_API_TOKEN,
        accountId: process.env.CF_ACCOUNT_ID,
      },
    },
    pool: {
      defaultCount: 3,
      strategy: 'round-robin',
      circuitBreaker: {
        failureThreshold: 3,
        cooldownSeconds: 60,
      },
    },
  },
});

await anyprox.init();

// Deploy 3 proxy endpoints
await anyprox.deploy({ count: 3 });

// Send a request with automatic IP rotation & failover
const response = await anyprox.fetch('https://httpbin.org/ip');
const data = await response.json();
console.log('Outbound IP:', data.origin);
```

### 2. Drop-in with Native `fetch` (Node.js 18+)

```typescript
import { AnyProx } from 'anyprox';

const anyprox = new AnyProx();
await anyprox.init();

// Create Undici dispatcher
const dispatcher = anyprox.createDispatcher();

// Use standard fetch
const response = await fetch('https://httpbin.org/ip', { dispatcher });
console.log(await response.json());
```

### 3. Drop-in with Axios

```typescript
import axios from 'axios';
import { AnyProx } from 'anyprox';

const anyprox = new AnyProx();
await anyprox.init();

const client = axios.create({
  httpAgent: anyprox.createHttpAgent(),
  httpsAgent: anyprox.createHttpsAgent(),
});

const response = await client.get('https://httpbin.org/ip');
console.log(response.data);
```

---

## Command Line Interface (CLI)

AnyProx comes with a full-featured CLI:

```bash
# 1. Interactive configuration
npx anyprox init

# 2. Deploy 3 proxy endpoints (Cloudflare or AWS)
npx anyprox deploy --count 3 --provider cloudflare
# Or multi-region AWS:
npx anyprox deploy --count 3 --provider aws --regions us-east-1,eu-west-1,ap-southeast-1

# 3. List active endpoints and status
npx anyprox list

# 4. Test endpoints latency and verify IP diversity
npx anyprox test

# 5. Start local forward proxy server on port 8080
npx anyprox serve --port 8080

# 6. Teardown all cloud resources
npx anyprox destroy --all
```

---

## Using with External Security Tools

By running `npx anyprox serve --port 8080`, you can route existing security tools through rotating cloud proxy endpoints with zero code modifications:

### curl
```bash
curl -x http://127.0.0.1:8080 https://httpbin.org/ip
```

### Nuclei
```bash
nuclei -u https://target.com -proxy http://127.0.0.1:8080
```

### Burp Suite / OWASP ZAP
1. Open Burp Suite -> **Settings** -> **Network** -> **Connections** -> **Upstream Proxy Servers**.
2. Add upstream proxy: `127.0.0.1:8080`.
3. All scanning, Repeater, and Intruder requests will now rotate through your cloud endpoints.

### ffuf
```bash
ffuf -w wordlist.txt -u https://target.com/FUZZ -x http://127.0.0.1:8080
```

---

## Configuration Schema (`anyprox.json`)

```json
{
  "$schema": "https://anyprox.dev/schema.json",
  "defaultProvider": "cloudflare",
  "providers": {
    "cloudflare": {
      "apiToken": "env:CF_API_TOKEN",
      "accountId": "env:CF_ACCOUNT_ID"
    },
    "aws": {
      "accessKeyId": "env:AWS_ACCESS_KEY_ID",
      "secretAccessKey": "env:AWS_SECRET_ACCESS_KEY",
      "defaultRegions": ["us-east-1", "us-west-2", "eu-west-1"]
    },
    "generic": {
      "proxies": [
        "http://user:pass@proxy1:8080",
        "socks5://127.0.0.1:9050"
      ]
    }
  },
  "pool": {
    "defaultCount": 3,
    "strategy": "round-robin",
    "circuitBreaker": {
      "failureThreshold": 3,
      "cooldownSeconds": 60,
      "retryOnStatus": [429, 403, 502, 503, 504]
    }
  },
  "server": {
    "port": 8080,
    "host": "127.0.0.1"
  }
}
```

---

## Extensibility: Writing a Custom Provider Plugin

AnyProx is designed to be easily extensible. Simply implement the `ProxyProvider` interface:

```typescript
import { AnyProx, type ProxyProvider, type ProxyEndpoint, type DeployOptions } from 'anyprox';

class MyCustomProvider implements ProxyProvider {
  readonly name = 'my-custom-provider';

  async init(config?: Record<string, unknown>): Promise<void> {
    // Validate credentials
  }

  async deploy(options: DeployOptions): Promise<ProxyEndpoint[]> {
    // Provision endpoints
    return [];
  }

  async list(): Promise<ProxyEndpoint[]> {
    return [];
  }

  async destroy(endpointIds?: string[]): Promise<void> {
    // Teardown resources
  }

  async healthCheck(endpoint: ProxyEndpoint) {
    return { healthy: true, latencyMs: 25, statusCode: 200 };
  }

  formatRequest(endpoint: ProxyEndpoint, targetUrl: string, init?: RequestInit) {
    return {
      url: `${endpoint.url}?url=${encodeURIComponent(targetUrl)}`,
      method: init?.method || 'GET',
      headers: { ...(init?.headers as any), 'x-target-url': targetUrl },
      body: null,
    };
  }
}

// Register with AnyProx
const anyprox = new AnyProx();
anyprox.registerProvider(new MyCustomProvider());
```