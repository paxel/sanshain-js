import { Command } from 'commander';
import { loadConfig } from './config';
import { SanshainClient, ProvideResponseBody } from './api';
import { SanshainCache } from './cache';
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
      const cache = new SanshainCache();
      let provided = false;

      const provideFile = async (p: any, branch: string, filePath: string, apiType?: string, baseVersion?: number) => {
        const specPath = path.resolve(process.cwd(), filePath);
        if (fs.existsSync(specPath)) {
          const content = fs.readFileSync(specPath, 'utf8');
          const effectiveApiType = apiType || 'openapi';
          const fileKey = path.basename(filePath);

          // Feature 3: Client-side content caching — skip if unchanged
          const contentHash = SanshainCache.computeHash(content);
          const cachedEntry = cache.getProvideEntry(fileKey);
          if (cachedEntry && contentHash === cachedEntry.content_hash) {
            console.log('\u23ed Spec unchanged (hash match), skipping provide.');
            return;
          }

          // Feature 1: Use cached version as base_version if not explicitly set
          let effectiveBaseVersion = baseVersion;
          if (effectiveBaseVersion === undefined && cachedEntry && cachedEntry.version > 0) {
            effectiveBaseVersion = cachedEntry.version;
          }

          console.log(`Providing ${effectiveApiType} ${config.serviceName} (branch: ${branch}) to ${url}...`);
          
          let response: ProvideResponseBody | null = null;
          if (effectiveApiType === 'openapi') {
            response = await client.provide({
              servicename: config.serviceName,
              branch,
              openapi_yaml: content,
              dry_run: options.dryRun,
              base_version: effectiveBaseVersion
            }, config.compression);
          } else if (effectiveApiType === 'asyncapi') {
            response = await client.provideAsyncApi({
              servicename: config.serviceName,
              branch,
              asyncapi_yaml: content,
              dry_run: options.dryRun,
              base_version: effectiveBaseVersion
            }, config.compression);
          } else if (effectiveApiType === 'proto' || effectiveApiType === 'grpc') {
            response = await client.provideProto({
              servicename: config.serviceName,
              branch,
              proto_content: content,
              dry_run: options.dryRun,
              base_version: effectiveBaseVersion
            }, config.compression);
          }

          // Feature 2: Log summary and save state
          if (response) {
            const c = response.changes || { inserts: 0, updates: 0, deletes: 0 };
            console.log(`\u2713 Provided to Sanshain v${response.version}: ${c.inserts} new, ${c.updates} updated, ${c.deletes} deleted endpoints`);
            const responseHash = response.content_hash || contentHash;
            cache.updateProvideEntry(fileKey, responseHash, response.version);
            cache.save();
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
          await provideFile(p, branch, p.file, p.apiType, p.baseVersion);
        }
        // Backward compatibility
        if (p.openApiFile) await provideFile(p, branch, p.openApiFile, 'openapi', p.baseVersion);
        if (p.asyncApiFile) await provideFile(p, branch, p.asyncApiFile, 'asyncapi', p.baseVersion);
        if (p.protoFile) await provideFile(p, branch, p.protoFile, 'proto', p.baseVersion);
      }

      if (!provided) {
        console.warn('No specification files found to provide.');
      } else {
        console.log('Successfully provided spec(s).');
      }
    } catch (error: any) {
      if (error.message && error.message.includes('Concurrent modification detected')) {
        console.error(error.message);
      } else {
        console.error(`Error providing spec: ${error.message}`);
      }
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
      const cache = new SanshainCache();

      for (const req of config.requires) {
        const reqBranch = req.branch || branch;
        const reqTimeout = req.timeout || config.timeout || 30;
        const outputDir = path.resolve(process.cwd(), req.outputDirectory);

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`Requiring ${req.serviceName} (branch: ${reqBranch}) from ${url}...`);

        try {
          let fileName: string;
          const ext = req.apiType === 'proto' ? 'proto' : 'yaml';

          if (req.endpoints.length === 1) {
            // Single endpoint require
            const endpoint = req.endpoints[0];
            const cacheKey = SanshainCache.requireKey(req.serviceName, reqBranch, endpoint.method, endpoint.path);
            const cachedEntry = cache.getRequireEntry(cacheKey);
            const cachedEtag = cachedEntry?.etag;

            const result = await client.require(
              config.serviceName,
              req.serviceName,
              reqBranch,
              endpoint.path,
              endpoint.method,
              reqTimeout,
              options.dryRun,
              req.apiType,
              cachedEtag
            );

            if (result.notModified) {
              console.log(`\u23ed ${req.serviceName} spec unchanged (304), skipping code generation.`);
              continue;
            }

            fileName = `${req.serviceName}.${ext}`;
            fs.writeFileSync(path.join(outputDir, fileName), result.content!);
            console.log(`Saved ${fileName} to ${req.outputDirectory}`);

            if (result.etag) {
              cache.updateRequireEntry(cacheKey, result.etag);
              cache.save();
            }
          } else {
            // Bundle require
            const cacheKey = SanshainCache.requireBundleKey(req.serviceName, reqBranch);
            const cachedEntry = cache.getRequireEntry(cacheKey);
            const cachedEtag = cachedEntry?.etag;

            const result = await client.requireBundle({
              clientname: config.serviceName,
              servicename: req.serviceName,
              branch: reqBranch,
              endpoints: req.endpoints,
              timeout: reqTimeout,
              dry_run: options.dryRun,
              api_type: req.apiType
            }, config.compression, cachedEtag);

            if (result.notModified) {
              console.log(`\u23ed ${req.serviceName} spec unchanged (304), skipping code generation.`);
              continue;
            }

            fileName = `${req.serviceName}_bundle.${ext}`;
            fs.writeFileSync(path.join(outputDir, fileName), result.content!);
            console.log(`Saved ${fileName} to ${req.outputDirectory}`);

            if (result.etag) {
              cache.updateRequireEntry(cacheKey, result.etag);
              cache.save();
            }
          }
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
