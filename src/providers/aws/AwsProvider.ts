import {
  LambdaClient,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  AddPermissionCommand,
  ListFunctionsCommand,
  DeleteFunctionCommand,
  GetFunctionUrlConfigCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  GetRoleCommand,
} from '@aws-sdk/client-iam';
import type {
  AwsProviderConfig,
  DeployOptions,
  HealthCheckResult,
  OutgoingProxyRequest,
  ProxyEndpoint,
  ProxyProvider,
} from '../../types/index.js';
import { getLambdaScript } from './lambdaTemplate.js';
import { createZipArchive } from './zipBuilder.js';
import { checkEndpointHealth } from '../../utils/ipChecker.js';
import { sanitizeRequestHeaders } from '../../utils/headerSanitizer.js';

const DEFAULT_AWS_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
];

const DEFAULT_ROLE_NAME = 'anyprox-lambda-execution-role';

export class AwsProvider implements ProxyProvider {
  readonly name = 'aws';
  private config: AwsProviderConfig = {};
  private defaultRegions: string[] = DEFAULT_AWS_REGIONS;

  constructor(config?: AwsProviderConfig) {
    if (config) {
      this.config = config;
      if (config.defaultRegions && config.defaultRegions.length > 0) {
        this.defaultRegions = config.defaultRegions;
      }
    }
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...(config as AwsProviderConfig) };
      if (this.config.defaultRegions && this.config.defaultRegions.length > 0) {
        this.defaultRegions = this.config.defaultRegions;
      }
    }

    const accessKeyId = this.config.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = this.config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'AwsProvider requires accessKeyId and secretAccessKey. ' +
        'Set them in configuration or via AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.'
      );
    }
  }

  private getLambdaClient(region: string): LambdaClient {
    return new LambdaClient({
      region,
      credentials: {
        accessKeyId: this.config.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: this.config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
        sessionToken: this.config.sessionToken || process.env.AWS_SESSION_TOKEN,
      },
    });
  }

  private getIAMClient(): IAMClient {
    return new IAMClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: this.config.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: this.config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
        sessionToken: this.config.sessionToken || process.env.AWS_SESSION_TOKEN,
      },
    });
  }

  /**
   * Ensures the basic Lambda execution role exists in the AWS account.
   */
  private async getOrCreateExecutionRole(): Promise<string> {
    const iam = this.getIAMClient();

    try {
      const getRes = await iam.send(new GetRoleCommand({ RoleName: DEFAULT_ROLE_NAME }));
      if (getRes.Role?.Arn) {
        return getRes.Role.Arn;
      }
    } catch {
      // Role doesn't exist, create it
    }

    const assumeRolePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    });

    const createRes = await iam.send(
      new CreateRoleCommand({
        RoleName: DEFAULT_ROLE_NAME,
        AssumeRolePolicyDocument: assumeRolePolicy,
        Description: 'Execution role for AnyProx Lambda proxy functions',
      })
    );

    await iam.send(
      new AttachRolePolicyCommand({
        RoleName: DEFAULT_ROLE_NAME,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      })
    );

    // Wait 5 seconds for IAM role propagation across AWS
    await new Promise((r) => setTimeout(r, 5000));

    if (!createRes.Role?.Arn) {
      throw new Error('Failed to retrieve ARN for created IAM execution role');
    }

    return createRes.Role.Arn;
  }

  async deploy(options: DeployOptions = {}): Promise<ProxyEndpoint[]> {
    const count = options.count ?? 1;
    const targetRegions = (options.regions && options.regions.length > 0)
      ? options.regions
      : this.defaultRegions;

    const roleArn = await this.getOrCreateExecutionRole();
    const zipBuffer = createZipArchive([
      { name: 'index.mjs', content: getLambdaScript() },
    ]);

    const endpoints: ProxyEndpoint[] = [];

    for (let i = 0; i < count; i++) {
      const region = targetRegions[i % targetRegions.length];
      const lambda = this.getLambdaClient(region);

      const timestamp = Math.floor(Date.now() / 1000);
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const functionName = `${options.namePrefix ?? 'anyprox-aws'}-${timestamp}-${randomSuffix}`;

      // 1. Create Lambda Function
      await lambda.send(
        new CreateFunctionCommand({
          FunctionName: functionName,
          Runtime: 'nodejs20.x',
          Role: roleArn,
          Handler: 'index.handler',
          Code: { ZipFile: zipBuffer },
          Description: 'AnyProx URL Redirection Proxy',
          Timeout: 30,
          MemorySize: 256,
        })
      );

      // 2. Create Function URL
      const urlRes = await lambda.send(
        new CreateFunctionUrlConfigCommand({
          FunctionName: functionName,
          AuthType: 'NONE',
          Cors: {
            AllowOrigins: ['*'],
            AllowMethods: ['*'],
            AllowHeaders: ['*'],
          },
        })
      );

      // 3. Add public invoke permission
      await lambda.send(
        new AddPermissionCommand({
          FunctionName: functionName,
          StatementId: 'FunctionURLAllowPublicAccess',
          Action: 'lambda:InvokeFunctionUrl',
          Principal: '*',
          FunctionUrlAuthType: 'NONE',
        })
      );

      const endpointUrl = urlRes.FunctionUrl ?? '';

      endpoints.push({
        id: functionName,
        provider: this.name,
        url: endpointUrl,
        region,
        createdAt: new Date().toISOString(),
        status: 'active',
        metadata: {
          functionName,
          region,
        },
      });
    }

    return endpoints;
  }

  async list(): Promise<ProxyEndpoint[]> {
    const endpoints: ProxyEndpoint[] = [];

    for (const region of this.defaultRegions) {
      try {
        const lambda = this.getLambdaClient(region);
        const listRes = await lambda.send(new ListFunctionsCommand({}));

        for (const fn of listRes.Functions ?? []) {
          const fnName = fn.FunctionName ?? '';
          if (fnName.startsWith('anyprox-aws-')) {
            try {
              const urlConfig = await lambda.send(
                new GetFunctionUrlConfigCommand({ FunctionName: fnName })
              );
              endpoints.push({
                id: fnName,
                provider: this.name,
                url: urlConfig.FunctionUrl ?? '',
                region,
                createdAt: fn.LastModified ?? new Date().toISOString(),
                status: 'active',
                metadata: {
                  functionName: fnName,
                  region,
                },
              });
            } catch {
              // URL config might not exist
            }
          }
        }
      } catch {
        // Region may not have access or functions
      }
    }

    return endpoints;
  }

  async destroy(endpointIds?: string[]): Promise<void> {
    const active = endpointIds && endpointIds.length > 0
      ? endpointIds
      : (await this.list()).map((ep) => ep.id);

    for (const region of this.defaultRegions) {
      const lambda = this.getLambdaClient(region);
      for (const id of active) {
        try {
          await lambda.send(new DeleteFunctionCommand({ FunctionName: id }));
        } catch {
          // Function might not exist in this region
        }
      }
    }
  }

  async healthCheck(endpoint: ProxyEndpoint): Promise<HealthCheckResult> {
    const probeUrl = `${endpoint.url}?url=https://httpbin.org/ip`;
    return checkEndpointHealth(probeUrl);
  }

  formatRequest(
    endpoint: ProxyEndpoint,
    targetUrl: string,
    init: RequestInit = {}
  ): OutgoingProxyRequest {
    const headers = sanitizeRequestHeaders(init.headers, targetUrl);
    headers['x-target-url'] = targetUrl;

    return {
      url: endpoint.url,
      method: init.method || 'GET',
      headers,
      body: init.body as string | Uint8Array | ReadableStream | null,
    };
  }
}
