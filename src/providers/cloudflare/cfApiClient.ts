/**
 * Cloudflare REST API v4 Client for AnyProx.
 */

export interface CfScriptSummary {
  id: string;
  created_on?: string;
  modified_on?: string;
}

export class CloudflareApiClient {
  private apiToken: string;
  private accountId: string;
  private baseUrl = 'https://api.cloudflare.com/client/v4';
  private cachedSubdomain: string | null = null;

  constructor(apiToken: string, accountId: string) {
    this.apiToken = apiToken;
    this.accountId = accountId;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get or automatically provision the workers.dev subdomain for the account.
   */
  async getOrProvisionSubdomain(): Promise<string> {
    if (this.cachedSubdomain) {
      return this.cachedSubdomain;
    }

    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/subdomain`;

    // 1. Check if subdomain already exists
    try {
      const res = await fetch(url, { headers: this.headers });
      if (res.ok) {
        const data = (await res.json()) as { result?: { subdomain?: string } };
        if (data.result?.subdomain) {
          this.cachedSubdomain = data.result.subdomain;
          return this.cachedSubdomain;
        }
      }
    } catch {
      // Continue to provision
    }

    // 2. Subdomain does not exist, provision one
    const prefix = this.accountId.slice(0, 8).toLowerCase();
    const suffix = Math.random().toString(36).substring(2, 6);
    const generatedSubdomain = `anyprox-${prefix}-${suffix}`;

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ subdomain: generatedSubdomain }),
    });

    if (putRes.ok) {
      const data = (await putRes.json()) as { result?: { subdomain?: string } };
      if (data.result?.subdomain) {
        this.cachedSubdomain = data.result.subdomain;
        return this.cachedSubdomain;
      }
    }

    // In case of 409 conflict, retry GET
    const retryRes = await fetch(url, { headers: this.headers });
    if (retryRes.ok) {
      const data = (await retryRes.json()) as { result?: { subdomain?: string } };
      if (data.result?.subdomain) {
        this.cachedSubdomain = data.result.subdomain;
        return this.cachedSubdomain;
      }
    }

    throw new Error(
      `Could not retrieve or provision Cloudflare workers.dev subdomain for account ${this.accountId}. ` +
      `Ensure API token has 'Workers Scripts: Edit' permissions.`
    );
  }

  /**
   * Upload an ES Module worker script.
   */
  async uploadWorkerScript(name: string, scriptContent: string): Promise<void> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${name}`;

    const formData = new FormData();
    const metadataBlob = new Blob(
      [
        JSON.stringify({
          main_module: 'worker.js',
          compatibility_date: '2024-01-01',
        }),
      ],
      { type: 'application/json' }
    );
    const scriptBlob = new Blob([scriptContent], { type: 'application/javascript+module' });

    formData.append('metadata', metadataBlob);
    formData.append('worker.js', scriptBlob, 'worker.js');

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to upload Cloudflare Worker '${name}' (HTTP ${res.status}): ${errText}`);
    }
  }

  /**
   * Enable the worker on the workers.dev subdomain.
   */
  async enableWorkerSubdomain(name: string, retries = 3): Promise<void> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${name}/subdomain`;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ enabled: true }),
        });

        if (res.ok) {
          return;
        }

        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          const errText = await res.text();
          throw new Error(`Failed to enable subdomain route for '${name}' (HTTP ${res.status}): ${errText}`);
        }
      } catch (err) {
        if (attempt >= retries - 1) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /**
   * List all workers scripts in the account.
   */
  async listWorkers(): Promise<CfScriptSummary[]> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts`;
    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to list Cloudflare Workers (HTTP ${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { result?: CfScriptSummary[] };
    return data.result ?? [];
  }

  /**
   * Delete a specific worker script.
   */
  async deleteWorker(name: string): Promise<boolean> {
    const url = `${this.baseUrl}/accounts/${this.accountId}/workers/scripts/${name}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    return res.status === 200 || res.status === 404;
  }
}
