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
  .version('2.0.0')
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
      const bestEffort = config.bestEffort || false;
      
      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const defaultBranch = globalOptions.branch || await getCurrentBranch() || 'main';
      const insecure = globalOptions.insecure || false;

      const provides = [];
      if (config.provide) provides.push(config.provide);
      if (config.provides) provides.push(...config.provides);

      if (provides.length === 0) {
        console.error('No provide section in sanshain.yaml');
        if (!bestEffort) process.exit(1);
        return;
      }

      const client = new SanshainClient(url, token, insecure);
      let provided = false;

      const provideFile = async (p: any, branch: string, filePath: string, apiType?: string) => {
        const specPath = path.resolve(process.cwd(), filePath);
        if (fs.existsSync(specPath)) {
          const content = fs.readFileSync(specPath, 'utf8');
          const effectiveApiType = apiType || 'openapi';
          console.log(`Providing ${effectiveApiType} ${config.serviceName} (branch: ${branch}) to ${url}...`);
          
          if (effectiveApiType === 'openapi') {
            await client.provide({
              servicename: config.serviceName,
              branch,
              openapi_yaml: content,
              dry_run: options.dryRun
            }, config.compression);
          } else if (effectiveApiType === 'asyncapi') {
            await client.provideAsyncApi({
              servicename: config.serviceName,
              branch,
              asyncapi_yaml: content,
              dry_run: options.dryRun
            }, config.compression);
          } else if (effectiveApiType === 'proto' || effectiveApiType === 'grpc') {
            await client.provideProto({
              servicename: config.serviceName,
              branch,
              proto_content: content,
              dry_run: options.dryRun
            }, config.compression);
          }
          provided = true;
        } else {
          console.error(`Spec file not found: ${specPath}`);
          if (!bestEffort) throw new Error(`Spec file not found: ${specPath}`);
        }
      };

      for (const p of provides) {
        const branch = p.branch || defaultBranch;
        if (p.file) {
          await provideFile(p, branch, p.file, p.apiType);
        }
        // Backward compatibility
        if (p.openApiFile) await provideFile(p, branch, p.openApiFile, 'openapi');
        if (p.asyncApiFile) await provideFile(p, branch, p.asyncApiFile, 'asyncapi');
        if (p.protoFile) await provideFile(p, branch, p.protoFile, 'proto');
      }

      if (!provided) {
        console.warn('No specification files found to provide.');
      } else {
        console.log('Successfully provided spec(s).');
      }
    } catch (error: any) {
      console.error(`Error providing spec: ${error.message}`);
      const config = loadConfig(program.opts().config);
      if (!(config.bestEffort || false)) {
        process.exit(1);
      } else {
        console.warn('Continuing (best effort)');
      }
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
      const bestEffort = config.bestEffort || false;
      
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

        try {
          let spec: string;
          let fileName: string;
          const ext = req.apiType === 'proto' ? 'proto' : 'yaml';

          if (req.endpoints.length === 1) {
            // Single endpoint require
            const endpoint = req.endpoints[0];
            spec = await client.require(
              config.serviceName,
              req.serviceName,
              reqBranch,
              endpoint.path,
              endpoint.method,
              reqTimeout,
              options.dryRun,
              req.apiType
            );
            fileName = `${req.serviceName}.${ext}`;
          } else {
            // Bundle require
            spec = await client.requireBundle({
              clientname: config.serviceName,
              servicename: req.serviceName,
              branch: reqBranch,
              endpoints: req.endpoints,
              timeout: reqTimeout,
              dry_run: options.dryRun,
              api_type: req.apiType
            }, config.compression);
            fileName = `${req.serviceName}_bundle.${ext}`;
          }
          fs.writeFileSync(path.join(outputDir, fileName), spec);
          console.log(`Saved ${fileName} to ${req.outputDirectory}`);
        } catch (error: any) {
          console.error(`Error requiring ${req.serviceName}: ${error.message}`);
          if (!bestEffort) {
            process.exit(1);
          } else {
            console.warn('Continuing (best effort)');
          }
        }
      }
    } catch (error: any) {
      console.error(`Error during require: ${error.message}`);
      const config = loadConfig(program.opts().config);
      if (!(config.bestEffort || false)) {
        process.exit(1);
      } else {
        console.warn('Continuing (best effort)');
      }
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}
