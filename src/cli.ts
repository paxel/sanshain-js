import { Command } from 'commander';
import { loadConfig, resolveStability, resolveStream } from './config';
import { SanshainClient, ProvideResponseBody, VersionConflictError, describeSubscription, isAdvisory } from './api';
import { SanshainCache } from './cache';
import fs from 'fs';
import path from 'path';

export const program = new Command();

program
  .name('sanshain')
  .description('Sanshain CLI client for managing OpenAPI specs')
  .version('2.3.0')
  .option('-c, --config <path>', 'path to sanshain.yaml', 'sanshain.yaml')
  .option('-u, --url <url>', 'Sanshain service URL')
  .option('-t, --token <token>', 'authentication token')
  .option('--ga', 'provide as immutable GA instead of the default snapshot (also: SANSHAIN_GA=true)', false)
  .option('--trunk', "this build is trunk's: it maintains the main graph (also: SANSHAIN_TRUNK=true)", false)
  .option('--tag <branch>', 'this build belongs to a sanshain-branch — release/hotfix pipelines (also: SANSHAIN_TAG)')
  .option('--insecure', 'allow insecure SSL connections', false)
  .option('--force', 're-provide even if the spec file is unchanged (skip the local hash cache)', false)
  .option('--best-effort', 'continue on errors', false);

program
  .command('provide')
  .description('Upload local API spec(s) to Sanshain under the version declared in the spec file')
  .option('--dry-run', 'validate spec without storing', false)
    .action(async (options) => {
    let config: any = { bestEffort: false };
    try {
      const globalOptions = program.opts();
      try {
        config = loadConfig(globalOptions.config);
      } catch (e) {
        const bestEffort = globalOptions.bestEffort || process.env.SANSHAIN_BEST_EFFORT === 'true';
        if (bestEffort) {
          console.warn(`Warning loading config: ${(e as Error).message}`);
          config = { bestEffort: true, sanshainUrl: 'http://localhost:8080' };
        } else {
          throw e;
        }
      }

      if (globalOptions.bestEffort) config.bestEffort = true;
      if (process.env.SANSHAIN_BEST_EFFORT === 'true') config.bestEffort = true;

      const force = globalOptions.force || config.force || process.env.SANSHAIN_FORCE === 'true' || false;
      const bestEffort = config.bestEffort || false;

      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const insecure = globalOptions.insecure || false;
      const stability = resolveStability(globalOptions.ga);
      const stream = resolveStream(globalOptions.trunk, globalOptions.tag);

      const strict = config.strict || false;

      if (!config.serviceName) {
        if (strict) {
          console.error('serviceName is required (in sanshain.yaml or via SANSHAIN_SERVICE_NAME)');
          process.exit(1);
        }
        console.warn('⚠ No serviceName configured. Skipping provide. Set strict: true to fail in this case.');
        return;
      }

      const provides = [];
      if (config.provide) provides.push(config.provide);
      if (config.provides) provides.push(...config.provides);

      if (provides.length === 0) {
        if (strict) {
          console.error('No provide section in sanshain.yaml');
          process.exit(1);
        }
        console.warn('⚠ No provide configuration found in sanshain.yaml. Skipping. Set strict: true to fail in this case.');
        return;
      }

      const client = new SanshainClient(url, token, insecure);
      const cache = new SanshainCache();
      let provided = false;

      const provideFile = async (filePath: string, apiType?: string) => {
        const specPath = path.resolve(process.cwd(), filePath);
        if (fs.existsSync(specPath)) {
          const content = fs.readFileSync(specPath, 'utf8');
          const effectiveApiType = apiType || 'openapi';
          const fileKey = path.basename(filePath);

          // Client-side content caching — skip if unchanged (unless force)
          const contentHash = SanshainCache.computeHash(content);
          const cachedEntry = cache.getProvideEntry(fileKey);
          if (!force && cachedEntry && contentHash === cachedEntry.content_hash) {
            console.log('⏭ Spec unchanged (hash match), skipping provide.');
            return;
          }

          console.log(`Providing ${effectiveApiType} ${config.serviceName} (stability: ${stability}) to ${url}...`);

          let response: ProvideResponseBody | null = null;
          try {
            if (effectiveApiType === 'openapi') {
              response = await client.provide({
                producername: config.serviceName,
                openapi_yaml: content,
                stability,
                dry_run: options.dryRun,
                ...stream
              }, config.compression);
            } else if (effectiveApiType === 'asyncapi') {
              response = await client.provideAsyncApi({
                producername: config.serviceName,
                asyncapi_yaml: content,
                stability,
                dry_run: options.dryRun,
                ...stream
              }, config.compression);
            } else if (effectiveApiType === 'proto' || effectiveApiType === 'grpc') {
              response = await client.provideProto({
                producername: config.serviceName,
                proto_content: content,
                stability,
                dry_run: options.dryRun,
                ...stream
              }, config.compression);
            }
          } catch (error: any) {
            if (error instanceof VersionConflictError) {
              const versionSlot = effectiveApiType === 'proto' || effectiveApiType === 'grpc'
                ? "the '// sanshain-version:' comment"
                : 'info.version';
              let message = `Provide rejected by the version rules (409): ${error.message}`;
              if (error.proposedVersion) {
                message += `\nPublish as ${error.proposedVersion} — update ${versionSlot} in ${filePath}`;
              }
              throw new Error(message);
            }
            throw error;
          }

          // Log summary and save state
          if (response) {
            const c = response.changes || { inserts: 0, updates: 0, deletes: 0 };
            console.log(`✓ Provided ${config.serviceName} ${response.version} (${response.stability}): ${c.inserts} new, ${c.updates} updated, ${c.deletes} deleted endpoints`);
            // Surface the harvest, or the feature is invisible: a subscription
            // expecting a field no contract guarantees would only be discovered
            // later, on the GA provide the server refuses. Advisories never
            // fail the build — that 409 is the server's job.
            for (const sub of response.harvested_subscriptions || []) {
              const line = `subscription ${describeSubscription(sub)}`;
              if (isAdvisory(sub)) {
                console.warn(`⚠ ${line}`);
              } else {
                console.log(`  ${line}`);
              }
            }
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

      const retireFamily = async (apiType?: string) => {
        const family = apiType || 'openapi';
        console.log(`Retiring ${family} for ${config.serviceName}...`);
        const shed = await client.retire(config.serviceName, family, options.dryRun);
        const cleared = shed?.tag_cleared ? `: cleared the '${shed.tag_cleared}' capability` : '';
        console.log(
          `✓ Retired${cleared}, closed ${shed?.trunk_pins_closed ?? 0} trunk pin(s), released ` +
            `${shed?.contracts_released ?? 0} contract(s). History and existing pins are untouched.`
        );
        provided = true;
      };

      for (const p of provides) {
        if (p.retired) {
          await retireFamily(p.apiType);
          continue;
        }
        if (p.file) {
          await provideFile(p.file, p.apiType);
        }
        // Backward compatibility
        if (p.openApiFile) await provideFile(p.openApiFile, 'openapi');
        if (p.asyncApiFile) await provideFile(p.asyncApiFile, 'asyncapi');
        if (p.protoFile) await provideFile(p.protoFile, 'proto');
      }

      if (!provided) {
        if (strict) {
          console.error('No specification files found to provide.');
          process.exit(1);
        }
        console.warn('⚠ No specification files found to provide. Skipping. Set strict: true to fail in this case.');
      } else {
        console.log('Successfully provided spec(s).');
      }
    } catch (error: any) {
      console.error(`Error providing spec: ${error.message}`);
      if (!(config.bestEffort || false)) {
        process.exit(1);
      } else {
        console.warn('Continuing (best effort)');
      }
    }
  });

program
  .command('require')
  .description('Download the pinned endpoint snippets from Sanshain')
  .option('--dry-run', 'validate dependencies without recording', false)
  .action(async (options) => {
    let config: any = { bestEffort: false };
    try {
      const globalOptions = program.opts();
      try {
        config = loadConfig(globalOptions.config);
      } catch (e) {
        const bestEffort = globalOptions.bestEffort || process.env.SANSHAIN_BEST_EFFORT === 'true';
        if (bestEffort) {
          console.warn(`Warning loading config: ${(e as Error).message}`);
          config = { bestEffort: true, sanshainUrl: 'http://localhost:8080' };
        } else {
          throw e;
        }
      }

      if (globalOptions.bestEffort) config.bestEffort = true;
      if (process.env.SANSHAIN_BEST_EFFORT === 'true') config.bestEffort = true;

      const bestEffort = config.bestEffort || false;

      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const insecure = globalOptions.insecure || false;

      const strict = config.strict || false;

      if (!config.serviceName) {
        if (strict) {
          console.error('serviceName is required (in sanshain.yaml or via SANSHAIN_SERVICE_NAME)');
          process.exit(1);
        }
        console.warn('⚠ No serviceName configured. Skipping require. Set strict: true to fail in this case.');
        return;
      }

      if (!config.requires || config.requires.length === 0) {
        if (strict) {
          console.error('No requires configured in sanshain.yaml');
          process.exit(1);
        }
        console.warn('⚠ No requires configured in sanshain.yaml. Skipping. Set strict: true to fail in this case.');
        return;
      }

      const client = new SanshainClient(url, token, insecure);
      const cache = new SanshainCache();
      const stream = resolveStream(globalOptions.trunk, globalOptions.tag);

      for (const req of config.requires) {
        const outputDir = path.resolve(process.cwd(), req.outputDirectory);

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`Requiring ${req.serviceName} ${req.version} from ${url}...`);

        try {
          let fileName: string;
          const ext = req.apiType === 'proto' ? 'proto' : 'yaml';

          if (req.endpoints.length === 1) {
            // Single endpoint require
            const endpoint = req.endpoints[0];
            const cacheKey = SanshainCache.requireKey(req.serviceName, req.version, endpoint.method, endpoint.path);
            const cachedEntry = cache.getRequireEntry(cacheKey);
            const cachedEtag = cachedEntry?.etag;

            const result = await client.require(
              config.serviceName,
              req.serviceName,
              req.version,
              endpoint.path,
              endpoint.method,
              options.dryRun,
              req.apiType,
              cachedEtag,
              stream
            );

            if (result.notModified) {
              console.log(`⏭ ${req.serviceName} spec unchanged (304), skipping code generation.`);
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
            const cacheKey = SanshainCache.requireBundleKey(req.serviceName, req.version);
            const cachedEntry = cache.getRequireEntry(cacheKey);
            const cachedEtag = cachedEntry?.etag;

            // The bundle takes the stream in the body — the server's bundle
            // handler reads no query parameters.
            const result = await client.requireBundle({
              consumername: config.serviceName,
              producername: req.serviceName,
              version: req.version,
              endpoints: req.endpoints,
              dry_run: options.dryRun,
              api_type: req.apiType,
              ...stream
            }, config.compression, cachedEtag);

            if (result.notModified) {
              console.log(`⏭ ${req.serviceName} spec unchanged (304), skipping code generation.`);
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
          console.error(`Error requiring ${req.serviceName} ${req.version}: ${error.message}`);
          if (!bestEffort) {
            process.exit(1);
          } else {
            console.warn('Continuing (best effort)');
          }
        }
      }
    } catch (error: any) {
      console.error(`Error during require: ${error.message}`);
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
