/**
 * The Action's step environment, evaluated from action.yml the way GitHub
 * does for the only expression forms it uses: `inputs.X` and
 * `inputs.X || env.Y` (an empty string is falsy).
 */
import fs from 'fs';
import path from 'path';
import { load } from 'js-yaml';

/** What these tests read of action.yml. */
interface ActionStep {
  env: Record<string, string>;
  run: string;
}
interface ActionFile {
  inputs: Record<string, { default?: string }>;
  runs: { steps: ActionStep[] };
}

const action = load(fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8')) as ActionFile;
const step = ((): ActionStep => {
  const [first] = action.runs.steps;
  if (!first) throw new Error('action.yml has no step');
  return first;
})();

function stepEnv(inputs: Record<string, string>, env: Record<string, string>): Record<string, string> {
  const given: Record<string, string> = {};
  for (const [name, spec] of Object.entries(action.inputs)) {
    given[name] = inputs[name] ?? spec.default ?? '';
  }
  const evaluate = (expression: string): string => {
    const match = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(expression);
    if (!match) return expression;
    for (const operand of (match[1] ?? '').split('||').map((o) => o.trim())) {
      const [scope, name = ''] = operand.split('.');
      const value = scope === 'inputs' ? given[name] : scope === 'env' ? (env[name] ?? '') : undefined;
      if (value === undefined) throw new Error(`unsupported expression: ${expression}`);
      if (value !== '') return value;
    }
    return '';
  };
  return Object.fromEntries(
    Object.entries(step.env)
      .filter(([name]) => name !== 'SANSHAIN_ACTION_COMMAND')
      .map(([name, value]) => [name, evaluate(value)]),
  );
}

const CALLER = {
  SANSHAIN_TOKEN: 'san_job',
  SANSHAIN_GA: 'false',
  SANSHAIN_TRUNK: 'true',
  SANSHAIN_TAG: 'R1',
  SANSHAIN_TICKETS: 'ORD-7',
  SANSHAIN_NOTE: 'from the job',
};

describe('the Action', () => {
  it('never puts an input into the script text', () => {
    expect(step.run).not.toContain('${{');
    expect(step.env.SANSHAIN_ACTION_COMMAND).toBe('${{ inputs.command }}');
    expect(step.run).toContain('$SANSHAIN_ACTION_COMMAND');
  });

  it('runs one exact released version, never the newest on npm', () => {
    const pinned = /npx --yes --ignore-scripts sanshain@(\d+)\.(\d+)\.(\d+) \$SANSHAIN_ACTION_COMMAND/.exec(step.run);
    expect(pinned).not.toBeNull();
    // At most the version being built: the pin names a release that is already
    // on npm, and it is raised after the publish.
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    const [ownMajor = 0, ownMinor = 0, ownPatch = 0] = manifest.version.split('.').map(Number);
    const [pinMajor = 0, pinMinor = 0, pinPatch = 0] = (pinned ?? []).slice(1).map(Number);
    const notNewer =
      pinMajor < ownMajor ||
      (pinMajor === ownMajor && (pinMinor < ownMinor || (pinMinor === ownMinor && pinPatch <= ownPatch)));
    expect(notNewer).toBe(true);
  });

  it('an empty input keeps what the job or workflow set', () => {
    expect(stepEnv({ command: 'provide' }, CALLER)).toEqual(CALLER);
  });

  it('a non-empty input replaces it', () => {
    const inputs = {
      command: 'provide',
      token: 'san_input',
      ga: 'true',
      trunk: 'false',
      tag: 'R2',
      tickets: 'ORD-9',
      note: 'from the input',
    };
    expect(stepEnv(inputs, CALLER)).toEqual({
      SANSHAIN_TOKEN: 'san_input',
      SANSHAIN_GA: 'true',
      SANSHAIN_TRUNK: 'false',
      SANSHAIN_TAG: 'R2',
      SANSHAIN_TICKETS: 'ORD-9',
      SANSHAIN_NOTE: 'from the input',
    });
  });

  it('without inputs or variables every setting stays empty', () => {
    expect(Object.values(stepEnv({ command: 'provide' }, {}))).toEqual(['', '', '', '', '', '']);
  });
});
