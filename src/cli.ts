import { Command } from 'commander';
import { loadConfig } from './config';
import { SanshainClient } from './api';
import { getCurrentBranch } from './git';
import fs from 'fs';
import path from 'path';

export const program = new Command();

program
  .name('sanshain')
  .description('Sanshain CLI client for managing OpenAPI specs')
  .version('1.0.0')
  .option('-c, --config <path>', 'path to sanshain.yaml', 'sanshain.yaml')
  .option('-u, --url <url>', 'Sanshain service URL')
  .option('-t, --token <token>', 'authentication token')
  .option('-b, --branch <branch>', 'git branch name')
  .option('--insecure', 'allow insecure SSL connections', false);

program
  .command('provide')
  .description('Upload local OpenAPI spec to Sanshain')
  .option('--dry-run', 'validate spec without storing', false)
  .action(async (options) => {
    try {
      const globalOptions = program.opts();
      const config = loadConfig(globalOptions.config);
      
      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const branch = globalOptions.branch || config.provide?.branch || await getCurrentBranch() || 'main';
      const insecure = globalOptions.insecure || false;

      if (!config.provide) {
        console.error('No provide section in sanshain.yaml');
        process.exit(1);
      }

      const specPath = path.resolve(process.cwd(), config.provide.openApiFile);
      if (!fs.existsSync(specPath)) {
        console.error(`Spec file not found: ${specPath}`);
        process.exit(1);
      }

      const openapi_yaml = fs.readFileSync(specPath, 'utf8');
      const client = new SanshainClient(url, token, insecure);

      console.log(`Providing ${config.provide.serviceName} (branch: ${branch}) to ${url}...`);
      await client.provide({
        servicename: config.provide.serviceName,
        branch,
        openapi_yaml,
        dry_run: options.dryRun
      }, config.compression);

      console.log('Successfully provided spec.');
    } catch (error: any) {
      console.error(`Error providing spec: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('require')
  .description('Download required OpenAPI specs from Sanshain')
  .option('--dry-run', 'validate dependencies without recording', false)
  .action(async (options) => {
    try {
      const globalOptions = program.opts();
      const config = loadConfig(globalOptions.config);
      
      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const branch = globalOptions.branch || await getCurrentBranch() || 'main';
      const insecure = globalOptions.insecure || false;

      if (!config.requires || config.requires.length === 0) {
        console.log('No requirements defined in sanshain.yaml');
        return;
      }

      const client = new SanshainClient(url, token, insecure);

      for (const req of config.requires) {
        const reqBranch = req.branch || branch;
        const reqTimeout = req.timeout || config.timeout || 30;
        const outputDir = path.resolve(process.cwd(), req.outputDirectory);

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`Requiring ${req.serviceName} (branch: ${reqBranch}) from ${url}...`);

        if (req.endpoints.length === 1) {
          // Single endpoint require
          const endpoint = req.endpoints[0];
          const yaml = await client.require(
            config.clientName,
            req.serviceName,
            reqBranch,
            endpoint.path,
            endpoint.method,
            reqTimeout,
            options.dryRun
          );
          const fileName = `${req.serviceName}.yaml`;
          fs.writeFileSync(path.join(outputDir, fileName), yaml);
          console.log(`Saved ${fileName} to ${req.outputDirectory}`);
        } else {
          // Bundle require
          const yaml = await client.requireBundle({
            clientname: config.clientName,
            servicename: req.serviceName,
            branch: reqBranch,
            endpoints: req.endpoints,
            timeout: reqTimeout,
            dry_run: options.dryRun
          }, config.compression);
          const fileName = `${req.serviceName}_bundle.yaml`;
          fs.writeFileSync(path.join(outputDir, fileName), yaml);
          console.log(`Saved ${fileName} to ${req.outputDirectory}`);
        }
      }
    } catch (error: any) {
      console.error(`Error requiring specs: ${error.message}`);
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}
