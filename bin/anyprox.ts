import { Command } from 'commander';
import pc from 'picocolors';
import ora from 'ora';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { AnyProx } from '../src/index.js';

const program = new Command();

program
  .name('anyprox')
  .description('Extensible Cloud Proxy & IP Rotation CLI')
  .version('0.1.0');

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --------------------------------------------------------------------------
// COMMAND: init
// --------------------------------------------------------------------------
program
  .command('init')
  .description('Initialize AnyProx configuration file interactively')
  .action(async () => {
    console.log(pc.bold(pc.cyan('\n=== AnyProx Configuration Setup ===\n')));

    console.log(pc.yellow('Select default provider:'));
    console.log('  1. Cloudflare Workers (Free 100k requests/day)');
    console.log('  2. AWS API Gateway / Lambda (Multi-Region)');
    const choice = await prompt('\nEnter choice (1 or 2) [1]: ');

    const defaultProvider = choice === '2' ? 'aws' : 'cloudflare';
    const config: any = {
      defaultProvider,
      providers: {},
      pool: {
        defaultCount: 3,
        strategy: 'round-robin',
        circuitBreaker: {
          failureThreshold: 3,
          cooldownSeconds: 60,
        },
      },
      server: {
        port: 8080,
        host: '127.0.0.1',
      },
    };

    if (defaultProvider === 'cloudflare') {
      console.log(pc.cyan('\nCloudflare Credentials:'));
      console.log(pc.gray('Create an API token at https://dash.cloudflare.com/profile/api-tokens'));
      const apiToken = await prompt('Cloudflare API Token: ');
      const accountId = await prompt('Cloudflare Account ID: ');

      config.providers.cloudflare = {
        apiToken: apiToken || 'env:CF_API_TOKEN',
        accountId: accountId || 'env:CF_ACCOUNT_ID',
      };
    } else {
      console.log(pc.cyan('\nAWS Credentials:'));
      const accessKeyId = await prompt('AWS Access Key ID: ');
      const secretAccessKey = await prompt('AWS Secret Access Key: ');

      config.providers.aws = {
        accessKeyId: accessKeyId || 'env:AWS_ACCESS_KEY_ID',
        secretAccessKey: secretAccessKey || 'env:AWS_SECRET_ACCESS_KEY',
        defaultRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
      };
    }

    const configPath = path.join(process.cwd(), 'anyprox.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log(pc.green(`\n✓ Configuration written to ${configPath}\n`));
    console.log('You can now run:');
    console.log(pc.bold('  npx anyprox deploy --count 3'));
    console.log(pc.bold('  npx anyprox serve --port 8080\n'));
  });

// --------------------------------------------------------------------------
// COMMAND: deploy
// --------------------------------------------------------------------------
program
  .command('deploy')
  .description('Deploy new proxy endpoints')
  .option('-p, --provider <provider>', 'Cloud provider (cloudflare, aws, generic)')
  .option('-c, --count <number>', 'Number of proxies to deploy', '1')
  .option('-r, --regions <regions>', 'Comma-separated list of target regions')
  .action(async (options) => {
    const anyprox = new AnyProx();
    await anyprox.init();

    const count = parseInt(options.count, 10);
    const provider = options.provider || anyprox.config.defaultProvider || 'cloudflare';
    const regions = options.regions ? options.regions.split(',').map((s: string) => s.trim()) : undefined;

    const spinner = ora(`Deploying ${count} proxy endpoint(s) on ${provider}...`).start();

    try {
      const endpoints = await anyprox.deploy({ count, provider, regions });
      spinner.succeed(pc.green(`Successfully deployed ${endpoints.length} endpoint(s)!`));

      console.log('\n' + pc.bold('Deployed Endpoints:'));
      for (const ep of endpoints) {
        console.log(`  • ${pc.cyan(ep.id)} [${ep.region || 'global'}]`);
        console.log(`    URL: ${pc.underline(ep.url)}`);
      }
      console.log('');
    } catch (err: unknown) {
      spinner.fail(pc.red(`Deployment failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// --------------------------------------------------------------------------
// COMMAND: list
// --------------------------------------------------------------------------
program
  .command('list')
  .description('List all active proxy endpoints')
  .option('-r, --refresh', 'Refresh list from remote cloud provider API')
  .action(async (options) => {
    const anyprox = new AnyProx();
    await anyprox.init();

    const spinner = ora('Retrieving proxy endpoints...').start();
    try {
      const endpoints = await anyprox.list(options.refresh);
      spinner.stop();

      if (endpoints.length === 0) {
        console.log(pc.yellow('\nNo proxy endpoints found.'));
        console.log(`Deploy some with: ${pc.bold('npx anyprox deploy --count 2')}\n`);
        return;
      }

      console.log(pc.bold(`\nAnyProx Endpoints (${endpoints.length} total):\n`));
      endpoints.forEach((ep, i) => {
        const statusColor = ep.status === 'active' ? pc.green : pc.yellow;
        console.log(`  ${pc.bold(`${i + 1}.`)} ${pc.cyan(ep.id)}`);
        console.log(`     Provider: ${ep.provider} | Region: ${ep.region || 'global'} | Status: ${statusColor(ep.status)}`);
        if (ep.egressIp) {
          console.log(`     Egress IP: ${pc.bold(pc.magenta(ep.egressIp))}`);
        }
        console.log(`     URL: ${pc.underline(ep.url)}\n`);
      });
    } catch (err: unknown) {
      spinner.fail(pc.red(`Failed to list endpoints: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// --------------------------------------------------------------------------
// COMMAND: test
// --------------------------------------------------------------------------
program
  .command('test')
  .description('Test endpoints health and display egress IP diversity')
  .action(async () => {
    const anyprox = new AnyProx();
    await anyprox.init();

    const endpoints = await anyprox.list();
    if (endpoints.length === 0) {
      console.log(pc.yellow('\nNo endpoints available to test. Deploy some first.\n'));
      return;
    }

    console.log(pc.bold(`\nTesting ${endpoints.length} endpoint(s)...\n`));

    const ipMap = new Map<string, string[]>();
    let passed = 0;

    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      const spinner = ora(`[${i + 1}/${endpoints.length}] Testing ${ep.id}...`).start();

      const [res] = await anyprox.test([ep]);
      if (res.health.healthy) {
        spinner.succeed(
          pc.green(`[${i + 1}/${endpoints.length}] ${ep.id} - ${res.health.latencyMs}ms | IP: ${pc.bold(res.health.egressIp || 'unknown')}`)
        );
        passed++;
        if (res.health.egressIp) {
          const list = ipMap.get(res.health.egressIp) || [];
          list.push(ep.id);
          ipMap.set(res.health.egressIp, list);
        }
      } else {
        spinner.fail(pc.red(`[${i + 1}/${endpoints.length}] ${ep.id} - FAILED: ${res.health.error}`));
      }
    }

    console.log('\n' + pc.bold('=== Test Summary ==='));
    console.log(`  Operational: ${passed}/${endpoints.length}`);
    console.log(`  Unique Egress IPs: ${pc.bold(pc.green(ipMap.size))}`);

    for (const [ip, workerIds] of ipMap) {
      console.log(`    • ${pc.magenta(ip)} (used by: ${workerIds.join(', ')})`);
    }

    if (ipMap.size < passed) {
      console.log(pc.yellow('\n⚠ Note: Some endpoints share the same outbound IP pool.'));
    }
    console.log('');
  });

// --------------------------------------------------------------------------
// COMMAND: serve
// --------------------------------------------------------------------------
program
  .command('serve')
  .description('Start local HTTP forward proxy server (for Burp, Nuclei, ZAP, curl)')
  .option('-p, --port <port>', 'Port to listen on', '8080')
  .option('-h, --host <host>', 'Host to bind to', '127.0.0.1')
  .action(async (options) => {
    const anyprox = new AnyProx();
    await anyprox.init();

    const endpoints = await anyprox.list();
    if (endpoints.length === 0) {
      console.log(pc.yellow('⚠ Warning: No proxy endpoints currently deployed.'));
      console.log(`Deploy endpoints in another tab: ${pc.bold('npx anyprox deploy --count 2')}\n`);
    }

    const port = parseInt(options.port, 10);
    const host = options.host;

    console.log(pc.bold(pc.cyan('\n=== AnyProx Local Proxy Server ===\n')));

    const server = await anyprox.serve({
      port,
      host,
      onRotate: (endpointId, targetUrl) => {
        console.log(
          pc.gray(`[${new Date().toLocaleTimeString()}]`) +
          ` Rotated -> ${pc.cyan(endpointId)} -> ${pc.white(targetUrl)}`
        );
      },
    });

    console.log(pc.green(`✓ Forward proxy listening on ${pc.bold(`http://${host}:${port}`)}`));
    console.log(pc.gray('Usage with curl:'));
    console.log(pc.white(`  curl -x http://${host}:${port} https://httpbin.org/ip\n`));
    console.log(pc.gray('Usage with Nuclei:'));
    console.log(pc.white(`  nuclei -u https://target.com -proxy http://${host}:${port}\n`));
    console.log(pc.gray('Press Ctrl+C to stop.\n'));

    process.on('SIGINT', async () => {
      console.log(pc.yellow('\nStopping proxy server...'));
      await server.stop();
      process.exit(0);
    });
  });

// --------------------------------------------------------------------------
// COMMAND: destroy
// --------------------------------------------------------------------------
program
  .command('destroy')
  .description('Destroy deployed proxy endpoints')
  .option('--all', 'Destroy all deployed endpoints without confirmation')
  .action(async (options) => {
    const anyprox = new AnyProx();
    await anyprox.init();

    const endpoints = await anyprox.list();
    if (endpoints.length === 0) {
      console.log(pc.yellow('\nNo endpoints to destroy.\n'));
      return;
    }

    if (!options.all) {
      const confirm = await prompt(
        pc.yellow(`Are you sure you want to delete ${endpoints.length} endpoint(s)? (y/N): `)
      );
      if (confirm.toLowerCase() !== 'y') {
        console.log('Teardown cancelled.');
        return;
      }
    }

    const spinner = ora(`Destroying ${endpoints.length} endpoint(s)...`).start();
    try {
      await anyprox.destroy();
      spinner.succeed(pc.green('All endpoints destroyed successfully. State cleared.'));
    } catch (err: unknown) {
      spinner.fail(pc.red(`Teardown failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
