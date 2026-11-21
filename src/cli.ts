import { Command, InvalidArgumentError } from 'commander';
import {
  UnknownFieldsError,
  configBaseDir,
  envFlag,
  fillAnnotations,
  loadConfig,
  parseSet,
  resolveOrigin,
  resolveStability,
  resolveStreamWithWarning,
  streamDeclared,
} from './config';
import {
  Annotation,
  CatalogPushResponse,
  SanshainClient,
  ProvideResponseBody,
  Stream,
  VersionConflictError,
  describeSubscription,
  isAdvisory,
} from './api';
import { SanshainCache } from './cache';
import { ProvideConfig, SanshainConfig } from './config';
import { displayUrl } from './utils';
import fs from 'fs';
import path from 'path';

export const program = new Command();

/** The options every command takes, as commander hands them over. */
interface GlobalOptions {
  config: string;
  url?: string;
  token?: string;
  ga: boolean;
  trunk: boolean;
  tag?: string;
  insecure: boolean;
  force: boolean;
  bestEffort: boolean;
  buildUrl?: string;
  changeUrl?: string;
  tickets?: string;
  note?: string;
  set?: Map<string, string>;
}

/** The options of provide and require. */
interface RunOptions {
  dryRun: boolean;
}

/** `value || fallback` for text: an empty text counts as none. */
function textOr<T extends string | undefined>(value: string | undefined, fallback: T): string | T {
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Text from the service, made safe for a terminal line: a control character (a line break, an
 * escape sequence) would start a forged line or recolour the output, so it shows as `?`.
 */
function printable(text: string): string {
  return text.replace(/\p{Cc}/gu, '?');
}

/** What a failure says: its message, or the thrown value itself as text. */
function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : String(error);
}

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
  const first = warnings[0];
  if (strict && first !== undefined) {
    if (error) console.error(messageOf(error));
    throw new StrictFailure(`strict: Sanshain warned: ${first}`);
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

/** Collects the repeatable --set NAME=value; a later one for the same NAME wins. */
function collectSet(arg: string, previous?: Map<string, string>): Map<string, string> {
  let name: string;
  let value: string;
  try {
    [name, value] = parseSet(arg);
  } catch (e) {
    throw new InvalidArgumentError(messageOf(e));
  }
  return new Map(previous ?? []).set(name, value);
}

/**
 * The annotations of sanshain.yaml with their placeholders filled from --set
 * and SANSHAIN_SET_*. Every entry left out is a warning; under strict the
 * first fails the command before any request, and best effort does not
 * soften that.
 */
function annotationsFor(config: SanshainConfig, strict: boolean): Annotation[] {
  const { annotations, warnings } = fillAnnotations(config.annotations, program.opts<GlobalOptions>().set);
  for (const warning of warnings) {
    console.warn(`⚠ ${warning}`);
  }
  const first = warnings[0];
  if (strict && first !== undefined) {
    throw new StrictFailure(`strict: ${first}`);
  }
  return annotations;
}

/**
 * Load sanshain.yaml for a command. A missing or broken file cannot be trusted
 * to say bestEffort or strict, so only --best-effort and SANSHAIN_BEST_EFFORT
 * soften it, and SANSHAIN_STRICT beats them: softened, the error is printed
 * with `prefix`, then `Continuing (best effort)`, and the command makes no
 * call (undefined). Otherwise the error is thrown, as are unknown fields
 * rejected by strict in a file that otherwise loads, which nothing softens.
 */
function loadConfigFor(prefix: string): SanshainConfig | undefined {
  const globalOptions = program.opts<GlobalOptions>();
  const bestEffort = globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');
  try {
    return loadConfig(globalOptions.config, bestEffort);
  } catch (error) {
    if (!bestEffort || envFlag('SANSHAIN_STRICT') || error instanceof UnknownFieldsError) throw error;
    console.error(`${prefix}: ${messageOf(error)}`);
    console.warn('Continuing (best effort)');
    return undefined;
  }
}

/**
 * The ETag to send as If-None-Match: none when the output file is gone, so the
 * answer is a 200 that writes it again instead of a 304 that leaves it missing.
 */
function etagFor(cache: SanshainCache, key: string, outputFile: string): string | undefined {
  return fs.existsSync(outputFile) ? cache.getRequireEntry(key)?.etag : undefined;
}

/**
 * The version in package.json, so a version bump cannot leave the CLI behind.
 * From src/ and from dist/ alike, package.json sits one directory up.
 */
function packageVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- read when the command starts: package.json lies outside src/, so an import would move the build's output
  return (require('../package.json') as { version: string }).version;
}

program
  .name('sanshain')
  .description('Sanshain CLI client for managing OpenAPI specs')
  .version(packageVersion())
  .option('-c, --config <path>', 'path to sanshain.yaml', 'sanshain.yaml')
  .option('-u, --url <url>', 'Sanshain service URL')
  .option('-t, --token <token>', 'authentication token')
  .option(
    '--ga',
    'provide as immutable GA instead of the default snapshot (also: SANSHAIN_GA=true; SANSHAIN_GA=false keeps a snapshot despite autoGa)',
    false,
  )
  .option('--trunk', "this build is trunk's: it maintains the main graph (also: SANSHAIN_TRUNK=true)", false)
  .option('--tag <branch>', 'this build belongs to a sanshain-branch — release/hotfix pipelines (also: SANSHAIN_TAG)')
  .option('--insecure', 'allow insecure SSL connections', false)
  .option('--force', 'no effect, kept for compatibility (every provide uploads)', false)
  .option(
    '--best-effort',
    'turn failed calls, and a missing or broken sanshain.yaml, into warnings and exit 0 (also: SANSHAIN_BEST_EFFORT=true or 1; bestEffort: true in sanshain.yaml counts for failed calls only; SANSHAIN_STRICT=true fails a missing or broken sanshain.yaml anyway)',
    false,
  )
  .option('--build-url <url>', "where this build ran (also: SANSHAIN_BUILD_URL; default: the runner's own variable)")
  .option(
    '--change-url <url>',
    "the pull or merge request behind this build (also: SANSHAIN_CHANGE_URL; default: the runner's own variable)",
  )
  .option('--tickets <ids>', 'ticket ids this build closes, comma-separated (also: SANSHAIN_TICKETS)')
  .option('--note <text>', 'one line of intent for this provide (also: SANSHAIN_NOTE)')
  .option(
    '--set <NAME=value>',
    'fill the {{NAME}} placeholders of the annotations in sanshain.yaml; repeatable (also: SANSHAIN_SET_NAME)',
    collectSet,
  );

program
  .command('provide')
  .description('Upload local API spec(s) to Sanshain under the version declared in the spec file')
  .option('--dry-run', 'validate spec without storing', false)
  .action(async (options: RunOptions) => {
    // Best effort as far as it is known: only once sanshain.yaml is loaded.
    let bestEffort = false;
    try {
      const globalOptions = program.opts<GlobalOptions>();
      const config = loadConfigFor('Error providing spec');
      if (!config) return;

      bestEffort = Boolean(config.bestEffort) || globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');

      const url = textOr(globalOptions.url, config.sanshainUrl);
      const token = textOr(globalOptions.token, process.env.SANSHAIN_TOKEN);
      const insecure = globalOptions.insecure;
      const origin = resolveOrigin(globalOptions);

      const strict = Boolean(config.strict);
      // The stream first: autoGa makes a provide GA on a build that declares one.
      const stream = streamFor(strict, globalOptions.trunk, globalOptions.tag);
      const stability = resolveStability(
        globalOptions.ga,
        config.autoGa === true,
        streamDeclared(globalOptions.trunk, globalOptions.tag),
      );
      const annotations = annotationsFor(config, strict);

      if (!config.serviceName) {
        if (strict) {
          console.error('serviceName is required (in sanshain.yaml or via SANSHAIN_SERVICE_NAME)');
          process.exit(1);
        }
        console.warn('⚠ No serviceName configured. Skipping provide. Set strict: true to fail in this case.');
        return;
      }

      const provides: ProvideConfig[] = [];
      if (config.provide) provides.push(config.provide);
      if (config.provides) provides.push(...config.provides);

      if (provides.length === 0) {
        if (strict) {
          console.error('No provide section in sanshain.yaml');
          process.exit(1);
        }
        console.warn(
          '⚠ No provide configuration found in sanshain.yaml. Skipping. Set strict: true to fail in this case.',
        );
        return;
      }

      const client = new SanshainClient(url, token, insecure);
      const baseDir = configBaseDir(globalOptions.config);
      // What the entries of this run came to; set from the steps below.
      const run = { provided: false, failed: false };

      // One provide or retire of this run. Under best effort its failure is a
      // warning and the next entry still runs, as require does per entry.
      const each = async (step: () => Promise<void>) => {
        try {
          await step();
        } catch (error) {
          if (!bestEffort || error instanceof StrictFailure) throw error;
          console.error(`Error providing spec: ${messageOf(error)}`);
          console.warn('Continuing (best effort)');
          run.failed = true;
        }
      };

      const provideFile = async (filePath: string, apiType?: string) => {
        const specPath = path.resolve(baseDir, filePath);
        if (fs.existsSync(specPath)) {
          run.provided = true;
          const content = fs.readFileSync(specPath, 'utf8');
          const effectiveApiType = textOr(apiType, 'openapi');
          // No local skip-if-unchanged: every provide uploads, and the server
          // treats an identical re-provide as a no-op.

          console.log(
            `Providing ${effectiveApiType} ${config.serviceName} (stability: ${stability}) to ${displayUrl(url)}...`,
          );

          let response: ProvideResponseBody | null = null;
          try {
            if (effectiveApiType === 'openapi') {
              response = await checked(client, strict, () =>
                client.provide(
                  {
                    producername: config.serviceName,
                    openapi_yaml: content,
                    stability,
                    dry_run: options.dryRun,
                    ...stream,
                    ...origin,
                    annotations,
                  },
                  config.compression,
                ),
              );
            } else if (effectiveApiType === 'asyncapi') {
              response = await checked(client, strict, () =>
                client.provideAsyncApi(
                  {
                    producername: config.serviceName,
                    asyncapi_yaml: content,
                    stability,
                    dry_run: options.dryRun,
                    ...stream,
                    ...origin,
                    annotations,
                  },
                  config.compression,
                ),
              );
            } else if (effectiveApiType === 'proto' || effectiveApiType === 'grpc') {
              response = await checked(client, strict, () =>
                client.provideProto(
                  {
                    producername: config.serviceName,
                    proto_content: content,
                    stability,
                    dry_run: options.dryRun,
                    ...stream,
                    ...origin,
                    annotations,
                  },
                  config.compression,
                ),
              );
            }
          } catch (error) {
            if (error instanceof VersionConflictError) {
              const versionSlot =
                effectiveApiType === 'proto' || effectiveApiType === 'grpc'
                  ? "the '// sanshain-version:' comment"
                  : 'info.version';
              let message = `Provide rejected by the version rules (409): ${error.message}`;
              if (error.proposedVersion) {
                message += `\nPublish as ${error.proposedVersion} — update ${versionSlot} in ${filePath}`;
              }
              throw new Error(message, { cause: error });
            }
            throw error;
          }

          // Log summary and save state
          if (response) {
            // The answer is the service's JSON: a field its type promises may still be missing.
            const answered: Partial<ProvideResponseBody> = response;
            const c = answered.changes ?? { inserts: 0, updates: 0, deletes: 0 };
            console.log(
              `✓ Provided ${config.serviceName} ${response.version} (${response.stability}): ` +
                `${String(c.inserts)} new, ${String(c.updates)} updated, ${String(c.deletes)} deleted endpoints`,
            );
            // Surface the harvest, or the feature is invisible: a subscription
            // expecting a field no contract guarantees would only be discovered
            // later, on the GA provide the server refuses. Advisories never
            // fail the build — that 409 is the server's job.
            for (const sub of response.harvested_subscriptions ?? []) {
              const line = `subscription ${describeSubscription(sub)}`;
              if (isAdvisory(sub)) {
                console.warn(`⚠ ${line}`);
              } else {
                console.log(`  ${line}`);
              }
            }
          }
        } else {
          console.error(`Spec file not found: ${specPath}`);
          if (!bestEffort) throw new Error(`Spec file not found: ${specPath}`);
        }
      };

      const retireFamily = async (apiType?: string) => {
        const family = textOr(apiType, 'openapi');
        run.provided = true;
        console.log(`Retiring ${family} for ${config.serviceName}...`);
        const shed = await checked(client, strict, () => client.retire(config.serviceName, family, options.dryRun));
        const cleared = shed?.tag_cleared ? `: cleared the '${shed.tag_cleared}' capability` : '';
        console.log(
          `✓ Retired${cleared}, closed ${String(shed?.trunk_pins_closed ?? 0)} trunk pin(s), released ` +
            `${String(shed?.contracts_released ?? 0)} contract(s). History and existing pins are untouched.`,
        );
      };

      for (const p of provides) {
        if (p.retired) {
          await each(() => retireFamily(p.apiType));
          continue;
        }
        const { file, openApiFile, asyncApiFile, protoFile } = p;
        if (file) {
          await each(() => provideFile(file, p.apiType));
        }
        // Backward compatibility
        if (openApiFile) await each(() => provideFile(openApiFile, 'openapi'));
        if (asyncApiFile) await each(() => provideFile(asyncApiFile, 'asyncapi'));
        if (protoFile) await each(() => provideFile(protoFile, 'proto'));
      }

      if (!run.provided) {
        if (strict) {
          console.error('No specification files found to provide.');
          process.exit(1);
        }
        console.warn('⚠ No specification files found to provide. Skipping. Set strict: true to fail in this case.');
      } else if (!run.failed) {
        console.log('Successfully provided spec(s).');
      }
    } catch (error) {
      console.error(error instanceof StrictFailure ? error.message : `Error providing spec: ${messageOf(error)}`);
      if (!bestEffort || error instanceof StrictFailure) {
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
  .action(async (options: RunOptions) => {
    let bestEffort = false;
    try {
      const globalOptions = program.opts<GlobalOptions>();
      const config = loadConfigFor('Error during require');
      if (!config) return;

      bestEffort = Boolean(config.bestEffort) || globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');

      const url = textOr(globalOptions.url, config.sanshainUrl);
      const token = textOr(globalOptions.token, process.env.SANSHAIN_TOKEN);
      const insecure = globalOptions.insecure;

      const strict = Boolean(config.strict);

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
      // The client sends only the system ones on a require.
      const annotations = annotationsFor(config, strict);
      const baseDir = configBaseDir(globalOptions.config);

      for (const req of config.requires) {
        const outputDir = path.resolve(baseDir, req.outputDirectory);

        // A dry run writes nothing, not even the directory.
        if (!options.dryRun && !fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`Requiring ${req.serviceName} ${req.version} from ${displayUrl(url)}...`);

        try {
          let fileName: string;
          const ext = req.apiType === 'proto' || req.apiType === 'grpc' ? 'proto' : 'yaml';

          const [endpoint] = req.endpoints;
          if (req.endpoints.length === 1 && endpoint) {
            // Single endpoint require
            fileName = `${req.serviceName}.${ext}`;
            const cacheKey = SanshainCache.requireKey(
              req.serviceName,
              req.version,
              endpoint.method,
              endpoint.path,
              req.format,
              req.outputDirectory,
            );
            const cachedEtag = etagFor(cache, cacheKey, path.join(outputDir, fileName));

            const result = await checked(client, strict, () =>
              client.require(
                config.serviceName,
                req.serviceName,
                req.version,
                endpoint.path,
                endpoint.method,
                options.dryRun,
                req.apiType,
                cachedEtag,
                stream,
                req.format,
                annotations,
              ),
            );

            if (result.notModified) {
              console.log(`⏭ ${req.serviceName} spec unchanged (304), skipping code generation.`);
              continue;
            }

            if (options.dryRun) {
              console.log(`Dry run - ${fileName} not written to ${req.outputDirectory}`);
              continue;
            }
            fs.writeFileSync(path.join(outputDir, fileName), result.content ?? '');
            console.log(`Saved ${fileName} to ${req.outputDirectory}`);

            if (result.etag) {
              cache.updateRequireEntry(cacheKey, result.etag);
              cache.save();
            }
          } else {
            // Bundle require
            fileName = `${req.serviceName}_bundle.${ext}`;
            const cacheKey = SanshainCache.requireBundleKey(
              req.serviceName,
              req.version,
              req.format,
              req.outputDirectory,
            );
            const cachedEtag = etagFor(cache, cacheKey, path.join(outputDir, fileName));

            // The bundle takes the stream in the body — the server's bundle
            // handler reads no query parameters.
            const result = await checked(client, strict, () =>
              client.requireBundle(
                {
                  consumername: config.serviceName,
                  producername: req.serviceName,
                  version: req.version,
                  endpoints: req.endpoints,
                  dry_run: options.dryRun,
                  ...(req.apiType === undefined ? {} : { api_type: req.apiType }),
                  ...stream,
                  annotations,
                },
                config.compression,
                cachedEtag,
                req.format,
              ),
            );

            if (result.notModified) {
              console.log(`⏭ ${req.serviceName} spec unchanged (304), skipping code generation.`);
              continue;
            }

            if (options.dryRun) {
              console.log(`Dry run - ${fileName} not written to ${req.outputDirectory}`);
              continue;
            }
            fs.writeFileSync(path.join(outputDir, fileName), result.content ?? '');
            console.log(`Saved ${fileName} to ${req.outputDirectory}`);

            if (result.etag) {
              cache.updateRequireEntry(cacheKey, result.etag);
              cache.save();
            }
          }
        } catch (error) {
          console.error(
            error instanceof StrictFailure
              ? error.message
              : `Error requiring ${req.serviceName} ${req.version}: ${messageOf(error)}`,
          );
          if (!bestEffort || error instanceof StrictFailure) {
            process.exit(1);
          } else {
            console.warn('Continuing (best effort)');
          }
        }
      }
    } catch (error) {
      console.error(error instanceof StrictFailure ? error.message : `Error during require: ${messageOf(error)}`);
      if (!bestEffort || error instanceof StrictFailure) {
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
    let bestEffort = false;
    try {
      const globalOptions = program.opts<GlobalOptions>();
      const config = loadConfigFor('Error pushing catalog');
      if (!config) return;

      bestEffort = Boolean(config.bestEffort) || globalOptions.bestEffort || envFlag('SANSHAIN_BEST_EFFORT');

      const url = textOr(globalOptions.url, config.sanshainUrl);
      const token = textOr(globalOptions.token, process.env.SANSHAIN_TOKEN);
      const insecure = globalOptions.insecure;
      const strict = Boolean(config.strict);

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
      const annotations = annotationsFor(config, strict);
      const catalogPath = path.resolve(configBaseDir(globalOptions.config), config.catalogInfo);
      let content: string;
      try {
        content = fs.readFileSync(catalogPath, 'utf8');
      } catch (e) {
        throw new Error(`Cannot read catalogInfo file ${catalogPath}: ${messageOf(e)}`, { cause: e });
      }

      const client = new SanshainClient(url, token, insecure);
      console.log(`Pushing catalog ${config.catalogInfo} for ${config.serviceName} to ${displayUrl(url)}...`);
      let pushed: CatalogPushResponse;
      try {
        pushed = await client.pushCatalog(config.serviceName, content, stream, config.compression, annotations);
      } catch (error) {
        reportWarnings(client.takeWarnings(), strict, error);
        throw error;
      }
      const warnings = client.takeWarnings();
      // The header names the reason; a service sending none still warns.
      if (!pushed.recorded && warnings.length === 0) {
        warnings.push(`Sanshain did not record ${catalogPath}`);
      }
      reportWarnings(warnings, strict);
      if (!pushed.recorded) return;
      // The answer is the service's JSON: a field its type promises may still be missing.
      const answered: Partial<CatalogPushResponse> = pushed;
      const resources = answered.resources ?? [];
      console.log(
        `Catalog recorded for ${printable(pushed.system)} (${pushed.trunk ? 'main+dev' : 'dev'}): ${String(resources.length)} resources`,
      );
      for (const resource of resources) {
        console.log(`  ${printable(resource)}`);
      }
    } catch (error) {
      console.error(error instanceof StrictFailure ? error.message : `Error pushing catalog: ${messageOf(error)}`);
      if (!bestEffort || error instanceof StrictFailure) {
        process.exit(1);
      } else {
        console.warn('Continuing (best effort)');
      }
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}
