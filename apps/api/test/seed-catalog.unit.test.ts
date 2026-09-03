/**
 * prisma/seed.catalog.sql carries 30 exam patterns nobody recomputes by hand. A config caches what
 * its sections add up to, so one edited without its cache describes a paper that cannot be sat:
 * marks a student can never reach, or a clock that ends before the sections do.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const CATALOG = readFileSync(join(__dirname, '../../../prisma/seed.catalog.sql'), 'utf8');

/** Splits one VALUES row on its top-level commas — a jsonb literal and an ARRAY[] hold their own. */
function cells(row: string): string[] {
  const out: string[] = [];
  let buffer = '';
  let quoted = false;
  let depth = 0;

  for (const char of row) {
    if (char === "'") quoted = !quoted;
    if (!quoted && (char === '[' || char === '(')) depth += 1;
    else if (!quoted && (char === ']' || char === ')')) depth -= 1;
    else if (!quoted && char === ',' && depth === 0) {
      out.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += char;
  }
  out.push(buffer.trim());
  return out;
}

function rowsOf(table: string): string[][] {
  const start = CATALOG.indexOf(`INSERT INTO "${table}"`);
  assert.notEqual(start, -1, `the catalog inserts nothing into ${table}`);

  const body = CATALOG.slice(CATALOG.indexOf('VALUES', start) + 'VALUES'.length);
  return [...body.slice(0, body.indexOf(';\n')).matchAll(/^\s*\((.*)\),?$/gm)].map((match) =>
    cells(match[1] ?? ''),
  );
}

const unquote = (value: string) => value.replace(/^'|'$/g, '');

interface Section {
  id: string;
  questions: number;
  marks: number;
  negative: number;
  seconds: number | null;
}

const configs = rowsOf('BaseConfig').map((row) => ({
  id: unquote(row[0] ?? ''),
  questions: Number(row[5]),
  marks: Number(row[6]),
  seconds: Number(row[7]),
}));

const sectionsByConfig = new Map<string, Section[]>();
for (const row of rowsOf('BaseConfigSection')) {
  const configId = unquote(row[1] ?? '');
  const section: Section = {
    id: unquote(row[0] ?? ''),
    questions: Number(row[5]),
    marks: Number(row[6]),
    negative: Number(row[7]),
    seconds: row[8] === 'NULL' ? null : Number(row[8]),
  };
  sectionsByConfig.set(configId, [...(sectionsByConfig.get(configId) ?? []), section]);
}

/** Two decimals, because marksPerQuestion is Decimal(6,2) and 45 × 1.33 is not 60 in binary. */
const round = (value: number) => Math.round(value * 100) / 100;

describe('the exam catalog seed', () => {
  /** SSC CGL Tier 1 is seed.sql's; a config declared in both files loses to the first one in. */
  it('describes twenty-nine configurations, each with sections', () => {
    assert.equal(configs.length, 29);
    assert.ok(!configs.some((config) => config.id === 'config_ssc_cgl_t1'));
    for (const config of configs) {
      assert.ok(sectionsByConfig.get(config.id)?.length, `${config.id} has no sections`);
    }
  });

  it('caches the question count its sections add up to', () => {
    for (const config of configs) {
      const sections = sectionsByConfig.get(config.id);
      assert.ok(sections);
      const counted = sections.reduce((sum, section) => sum + section.questions, 0);
      assert.equal(counted, config.questions, `${config.id} counts ${config.questions}`);
    }
  });

  /** The bug: a paper told a student it was out of 200 when its sections could award 199.70. */
  it('caches the marks its sections can actually award', () => {
    for (const config of configs) {
      const sections = sectionsByConfig.get(config.id);
      assert.ok(sections);
      const awardable = round(
        sections.reduce((sum, section) => sum + section.questions * section.marks, 0),
      );
      assert.equal(awardable, config.marks, `${config.id} claims ${config.marks}`);
    }
  });

  /** The bug: a sectional paper's own clock ended twenty minutes before its last section's did. */
  it('runs for exactly as long as its sections do, where they are timed', () => {
    for (const config of configs) {
      const sections = sectionsByConfig.get(config.id);
      assert.ok(sections);
      if (sections.some((section) => section.seconds === null)) continue;

      const clocked = sections.reduce((sum, section) => sum + (section.seconds ?? 0), 0);
      assert.equal(clocked, config.seconds, `${config.id} runs ${config.seconds}s`);
    }
  });

  /** The bug: 20.00 deducted per wrong answer on a one-mark question, so ten wrong beat the paper. */
  it('never deducts more for a wrong answer than the question is worth', () => {
    for (const [configId, sections] of sectionsByConfig) {
      for (const section of sections) {
        assert.ok(
          section.negative <= section.marks,
          `${configId}/${section.id} deducts ${section.negative} of ${section.marks}`,
        );
      }
    }
  });
});
