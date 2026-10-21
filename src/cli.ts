import { Command } from 'commander';
import { UnknownFieldsError, configBaseDir, envFlag, loadConfig, resolveOrigin, resolveStability, resolveStreamWithWarning } from './config';
import {
  CatalogPushResponse,
  SanshainClient,
  ProvideResponseBody,
  Stream,
  VersionConflictError,
  describeSubscription,
  isAdvisory
} from './api';
import { SanshainCache } from './cache';
import fs from 'fs';
import path from 'path';

export const program = new Command();

/** A failure strict mode demands. Best effort never softens it. */
export class StrictFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrictFailure';
  }
}

/**
 * Print each warning Sanshain sent with a call. Under strict the first one
 * fails the command — after printing the call's own error, if it had one.
 */
function reportWarnings(warnings: string[], strict: boolean, error?: unknown): void {
  for (const warning of warnings) {
    console.warn(`⚠ ${warning}`);
  }
  if (strict && warnings.length > 0) {
    if (error) console.error((error as Error).message ?? String(error));
    throw new StrictFailure(`strict: Sanshain warned: ${warnings[0]}`);
  }
}

/** Run one Sanshain call and report the warnings it brought, whether it succeeded or not. */
async function checked<T>(client: SanshainClient, strict: boolean, call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (error) {
    reportWarnings(client.takeWarnings(), strict, error);
    throw error;
  }
  reportWarnings(client.takeWarnings(), strict);
  return result;
}

/**
 * The build's stream. Both trunk and a tag is no error: the build is recorded
 * in neither, with a warning — and under strict, a failure before any request.
 */
function streamFor(strict: boolean, trunkFlag?: boolean, tagFlag?: string): Stream {
  const { stream, warning } = resolveStreamWithWarning(trunkFlag, tagFlag);
  if (warning) {
    console.warn(`⚠ ${warning}`);
    if (strict) throw new StrictFailure(`strict: ${warning}`);
  }
  return stream;
}

program
  .name('sanshain')
  .description('Sanshain CLI client for managing OpenAPI specs')
  .version('2.5.0')
  .option('-c, --config <path>', 'path to sanshain.yaml', 'sanshain.yaml')
  .option('-u, --url <url>', 'Sanshain service URL')
  .option('-t, --token <token>', 'authentication token')
  .option('--ga', 'provide as immutable GA instead of the default snapshot (also: SANSHAIN_GA=true)', false)
  .option('--trunk', "this build is trunk's: it maintains the main graph (also: SANSHAIN_TRUNK=true)", false)
  .option('--tag <branch>', 'this build belongs to a sanshain-branch — release/hotfix pipelines (also: SANSHAIN_TAG)')
  .option('--insecure', 'allow insecure SSL connections', false)
  .option('--force', 'no effect, kept for compatibility (every provide uploads)', false)
  .option('--best-effort', 'continue on errors', false)
  .option('--build-url <url>', "where this build ran (also: SANSHAIN_BUILD_URL; default: the runner's own variable)")
  .option('--change-url <url>', "the pull or merge request behind this build (also: SANSHAIN_CHANGE_URL; default: the runner's own variable)")
  .option('--tickets <ids>', 'ticket ids this build closes, comma-separated (also: SANSHAIN_TICKETS)')
  .option('--note <text>', 'one line of intent for this provide (also: SANSHAIN_NOTE)');

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
        const bestEffort = globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');
        // Strict rejecting unknown fields is a config error best-effort never softens.
        if (bestEffort && !(e instanceof UnknownFieldsError)) {
          console.warn(`Warning loading config: ${(e as Error).message}`);
          config = { bestEffort: true, sanshainUrl: 'http://localhost:8080' };
        } else {
          throw e;
        }
      }

      if (globalOptions.bestEffort) config.bestEffort = true;
      if (envFlag('SANSHAIN_BEST_EFFORT')) config.bestEffort = true;

      const bestEffort = config.bestEffort || false;

      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const insecure = globalOptions.insecure || false;
      const stability = resolveStability(globalOptions.ga);
      const origin = resolveOrigin({
        buildUrl: globalOptions.buildUrl,
        changeUrl: globalOptions.changeUrl,
        tickets: globalOptions.tickets,
        note: globalOptions.note,
      });

      const strict = config.strict || false;
      const stream = streamFor(strict, globalOptions.trunk, globalOptions.tag);

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
      const baseDir = configBaseDir(globalOptions.config);
      let provided = false;

      const provideFile = async (filePath: string, apiType?: string) => {
        const specPath = path.resolve(baseDir, filePath);
        if (fs.existsSync(specPath)) {
          const content = fs.readFileSync(specPath, 'utf8');
          const effectiveApiType = apiType || 'openapi';
          // No local skip-if-unchanged: every provide uploads, and the server
          // treats an identical re-provide as a no-op.

          console.log(`Providing ${effectiveApiType} ${config.serviceName} (stability: ${stability}) to ${url}...`);

          let response: ProvideResponseBody | null = null;
          try {
            if (effectiveApiType === 'openapi') {
              response = await checked(client, strict, () => client.provide({
                producername: config.serviceName,
                openapi_yaml: content,
                stability,
                dry_run: options.dryRun,
                ...stream,
                ...origin
              }, config.compression));
            } else if (effectiveApiType === 'asyncapi') {
              response = await checked(client, strict, () => client.provideAsyncApi({
                producername: config.serviceName,
                asyncapi_yaml: content,
                stability,
                dry_run: options.dryRun,
                ...stream,
                ...origin
              }, config.compression));
            } else if (effectiveApiType === 'proto' || effectiveApiType === 'grpc') {
              response = await checked(client, strict, () => client.provideProto({
                producername: config.serviceName,
                proto_content: content,
                stability,
                dry_run: options.dryRun,
                ...stream,
                ...origin
              }, config.compression));
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
        const shed = await checked(client, strict, () => client.retire(config.serviceName, family, options.dryRun));
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
      console.error(error instanceof StrictFailure ? error.message : `Error providing spec: ${error.message}`);
      if (!(config.bestEffort || false) || error instanceof StrictFailure) {
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
        const bestEffort = globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');
        // Strict rejecting unknown fields is a config error best-effort never softens.
        if (bestEffort && !(e instanceof UnknownFieldsError)) {
          console.warn(`Warning loading config: ${(e as Error).message}`);
          config = { bestEffort: true, sanshainUrl: 'http://localhost:8080' };
        } else {
          throw e;
        }
      }

      if (globalOptions.bestEffort) config.bestEffort = true;
      if (envFlag('SANSHAIN_BEST_EFFORT')) config.bestEffort = true;

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
      const stream = streamFor(strict, globalOptions.trunk, globalOptions.tag);
      const baseDir = configBaseDir(globalOptions.config);

      for (const req of config.requires) {
        const outputDir = path.resolve(baseDir, req.outputDirectory);

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
            const cacheKey = SanshainCache.requireKey(req.serviceName, req.version, endpoint.method, endpoint.path, req.format);
            const cachedEntry = cache.getRequireEntry(cacheKey);
            const cachedEtag = cachedEntry?.etag;

            const result = await checked(client, strict, () => client.require(
              config.serviceName,
              req.serviceName,
              req.version,
              endpoint.path,
              endpoint.method,
              options.dryRun,
              req.apiType,
              cachedEtag,
              stream,
              req.format
            ));

            if (result.notModified) {
              console.log(`⏭ ${req.serviceName} spec unchanged (304), skipping code generation.`);
              continue;
            }

            fileName = `${req.serviceName}.${ext}`;
            fs.writeFileSync(path.join(outputDir, fileName), result.content!);
            console.log(`Saved ${fileName} to ${req.outputDirectory}`);

            // A dry run records nothing, locally either.
            if (result.etag && !options.dryRun) {
              cache.updateRequireEntry(cacheKey, result.etag);
              cache.save();
            }
          } else {
            // Bundle require
            const cacheKey = SanshainCache.requireBundleKey(req.serviceName, req.version, req.format);
            const cachedEntry = cache.getRequireEntry(cacheKey);
            const cachedEtag = cachedEntry?.etag;

            // The bundle takes the stream in the body — the server's bundle
            // handler reads no query parameters.
            const result = await checked(client, strict, () => client.requireBundle({
              consumername: config.serviceName,
              producername: req.serviceName,
              version: req.version,
              endpoints: req.endpoints,
              dry_run: options.dryRun,
              api_type: req.apiType,
              ...stream
            }, config.compression, cachedEtag, req.format));

            if (result.notModified) {
              console.log(`⏭ ${req.serviceName} spec unchanged (304), skipping code generation.`);
              continue;
            }

            fileName = `${req.serviceName}_bundle.${ext}`;
            fs.writeFileSync(path.join(outputDir, fileName), result.content!);
            console.log(`Saved ${fileName} to ${req.outputDirectory}`);

            // A dry run records nothing, locally either.
            if (result.etag && !options.dryRun) {
              cache.updateRequireEntry(cacheKey, result.etag);
              cache.save();
            }
          }
        } catch (error: any) {
          console.error(
            error instanceof StrictFailure
              ? error.message
              : `Error requiring ${req.serviceName} ${req.version}: ${error.message}`
          );
          if (!bestEffort || error instanceof StrictFailure) {
            process.exit(1);
          } else {
            console.warn('Continuing (best effort)');
          }
        }
      }
    } catch (error: any) {
      console.error(error instanceof StrictFailure ? error.message : `Error during require: ${error.message}`);
      if (!(config.bestEffort || false) || error instanceof StrictFailure) {
        process.exit(1);
      } else {
        console.warn('Continuing (best effort)');
      }
    }
  });

program
  .command('catalog')
  .description("Push the system's Backstage catalog-info.yaml (catalogInfo) to Sanshain — needs Sanshain Service 2.4.0")
  .action(async () => {
    let config: any = { bestEffort: false };
    try {
      const globalOptions = program.opts();
      try {
        config = loadConfig(globalOptions.config);
      } catch (e) {
        const bestEffort = globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');
        // Strict rejecting unknown fields is a config error best-effort never softens.
        if (bestEffort && !(e instanceof UnknownFieldsError)) {
          console.warn(`Warning loading config: ${(e as Error).message}`);
          config = { bestEffort: true, sanshainUrl: 'http://localhost:8080' };
        } else {
          throw e;
        }
      }

      if (globalOptions.bestEffort) config.bestEffort = true;
      if (envFlag('SANSHAIN_BEST_EFFORT')) config.bestEffort = true;

      const url = globalOptions.url || config.sanshainUrl;
      const token = globalOptions.token || process.env.SANSHAIN_TOKEN;
      const insecure = globalOptions.insecure || false;
      const strict = config.strict || false;

      // Strict here checks only what this command needs — never provides/requires.
      if (!config.serviceName) {
        if (strict) {
          console.error('serviceName is required (in sanshain.yaml or via SANSHAIN_SERVICE_NAME)');
          process.exit(1);
        }
        console.warn('⚠ No serviceName configured. Skipping catalog. Set strict: true to fail in this case.');
        return;
      }

      if (!config.catalogInfo) {
        if (strict) {
          console.error('strict: sanshain.yaml has no catalogInfo');
          process.exit(1);
        }
        console.warn('No catalogInfo in sanshain.yaml - skipping catalog.');
        return;
      }

      const stream = streamFor(strict, globalOptions.trunk, globalOptions.tag);
      const catalogPath = path.resolve(configBaseDir(globalOptions.config), config.catalogInfo);
      let content: string;
      try {
        content = fs.readFileSync(catalogPath, 'utf8');
      } catch (e) {
        throw new Error(`Cannot read catalogInfo file ${catalogPath}: ${(e as Error).message}`);
      }

      const client = new SanshainClient(url, token, insecure);
      console.log(`Pushing catalog ${config.catalogInfo} for ${config.serviceName} to ${url}...`);
      let pushed: CatalogPushResponse | undefined;
      let failure: unknown;
      try {
        pushed = await client.pushCatalog(config.serviceName, content, stream, config.compression);
      } catch (error) {
        failure = error;
      }
      const warnings = client.takeWarnings();
      // The header names the reason; a service sending none still warns.
      if (pushed && !pushed.recorded && warnings.length === 0) {
        warnings.push(`Sanshain did not record ${catalogPath}`);
      }
      reportWarnings(warnings, strict, failure);
      if (failure) throw failure;
      if (!pushed!.recorded) return;
      const resources = pushed!.resources || [];
      console.log(
        `Catalog recorded for ${pushed!.system} (${pushed!.trunk ? 'main+dev' : 'dev'}): ${resources.length} resources`
      );
      for (const resource of resources) {
        console.log(`  ${resource}`);
      }
    } catch (error: any) {
      console.error(error instanceof StrictFailure ? error.message : `Error pushing catalog: ${error.message}`);
      if (!(config.bestEffort || false) || error instanceof StrictFailure) {
        process.exit(1);
      } else {
        console.warn('Continuing (best effort)');
      }
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}
