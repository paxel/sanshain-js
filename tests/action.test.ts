/**
 * The Action's step environment, evaluated from action.yml the way GitHub
 * does for the only expression forms it uses: `inputs.X` and
 * `inputs.X || env.Y` (an empty string is falsy).
 */
import fs from 'fs';
import path from 'path';
import { load } from 'js-yaml';

const action = load(fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8')) as any;
const step = action.runs.steps[0];

function stepEnv(inputs: Record<string, string>, env: Record<string, string>): Record<string, string> {
  const given: Record<string, string> = {};
  for (const [name, spec] of Object.entries<any>(action.inputs)) {
    given[name] = inputs[name] ?? spec.default ?? '';
  }
  const evaluate = (expression: string): string => {
    const match = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(expression);
    if (!match) return expression;
    for (const operand of match[1].split('||').map((o) => o.trim())) {
      const [scope, name] = operand.split('.');
      const value = scope === 'inputs' ? given[name] : scope === 'env' ? env[name] ?? '' : undefined;
      if (value === undefined) throw new Error(`unsupported expression: ${expression}`);
      if (value !== '') return value;
    }
    return '';
  };
  return Object.fromEntries(Object.entries<string>(step.env).map(([name, value]) => [name, evaluate(value)]));
}

const CALLER = {
  SANSHAIN_TOKEN: 'san_job',
  SANSHAIN_GA: 'false',
  SANSHAIN_TRUNK: 'true',
  SANSHAIN_TAG: 'R1',
  SANSHAIN_TICKETS: 'ORD-7',
  SANSHAIN_NOTE: 'from the job'
};

describe('the Action', () => {
  it('an empty input keeps what the job or workflow set', () => {
    expect(stepEnv({ command: 'provide' }, CALLER)).toEqual(CALLER);
  });

  it('a non-empty input replaces it', () => {
    const inputs = { command: 'provide', token: 'san_input', ga: 'true', trunk: 'false', tag: 'R2', tickets: 'ORD-9', note: 'from the input' };
    expect(stepEnv(inputs, CALLER)).toEqual({
      SANSHAIN_TOKEN: 'san_input',
      SANSHAIN_GA: 'true',
      SANSHAIN_TRUNK: 'false',
      SANSHAIN_TAG: 'R2',
      SANSHAIN_TICKETS: 'ORD-9',
      SANSHAIN_NOTE: 'from the input'
    });
  });

  it('without inputs or variables every setting stays empty', () => {
    expect(Object.values(stepEnv({ command: 'provide' }, {}))).toEqual(['', '', '', '', '', '']);
  });
});
