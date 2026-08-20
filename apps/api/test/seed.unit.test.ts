import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * prisma/seed.sql is the only thing that puts a super admin, an exam catalog and the SSC
 * CGL Tier 1 pattern into a fresh database. It is run by hand, so nothing else would
 * notice if it stopped being re-runnable or if its cached totals drifted from its sections.
 */
const SEED = readFileSync(join(__dirname, '../../../prisma/seed.sql'), 'utf8');

const SEEDED_TABLES = [...SEED.matchAll(/INSERT INTO "(\w+)"/g)].map((match) => match[1]!);

/** The file's own header explains why an arbiter is wrong, so it quotes the thing it forbids. */
const STATEMENTS = SEED.replace(/^\s*--.*$/gm, '');

/** The top-level parenthesised groups in `text`, ignoring anything inside a string literal. */
function parenGroups(text: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = 0;
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === '(') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) groups.push(text.slice(start, i));
    }
  }
  return groups;
}

/** Splits a VALUES row on the commas that separate columns — not those inside ARRAY[...]. */
function columns(row: string): string[] {
  const cells: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      cells.push(row.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(row.slice(start));
  return cells.map((cell) => cell.trim().replace(/^'|'$/g, ''));
}

/**
 * The VALUES rows of the insert into `table`. Everything before VALUES is the column
 * list, so it is dropped by position rather than by counting cells — a three-column
 * insert is a real row, and a helper that quietly returns nothing makes every assertion
 * over it pass without checking anything.
 */
function insertedRows(table: string): string[][] {
  const statement = new RegExp(`INSERT INTO "${table}"[\\s\\S]*?;`).exec(SEED);
  assert.ok(statement, `seed.sql inserts nothing into ${table}`);

  const values = /\bVALUES\b/.exec(statement[0]);
  assert.ok(values, `the ${table} insert has no VALUES clause`);

  const rows = parenGroups(statement[0].slice(values.index + values[0].length)).map(columns);
  assert.ok(rows.length > 0, `no VALUES rows could be read out of the ${table} insert`);
  return rows;
}

describe('the seed is safe to run again', () => {
  /** The failure this prevents: a second run erroring, or worse, doubling a row. */
  it('guards every insert it makes', () => {
    assert.ok(SEEDED_TABLES.length > 0);
    for (const table of SEEDED_TABLES) {
      const statement = new RegExp(`INSERT INTO "${table}"[\\s\\S]*?;`).exec(SEED)!;
      assert.match(statement[0], /ON CONFLICT DO NOTHING;$/);
    }
  });

  /**
   * The failure this prevents: `ON CONFLICT (col)` absorbs a conflict on that one index
   * and raises on every other. A config can collide on its primary key OR on the partial
   * unique over ("examStageId") WHERE "isDefault", so naming either one leaves the seed
   * erroring after an admin has promoted a default of their own.
   */
  it('names no arbiter, so a conflict on any constraint is absorbed', () => {
    assert.doesNotMatch(STATEMENTS, /ON CONFLICT \(/);
  });
});

describe('reading the seed', () => {
  /** The helper returning [] would make every assertion built on it pass vacuously. */
  it('reads a row per table, including a three-column one', () => {
    assert.equal(insertedRows('Subject').length, 4);
    assert.equal(insertedRows('Subject')[0]!.length, 3);
  });

  /** An ARRAY[...] literal contains commas that do not separate columns. */
  it('does not split an array literal into extra columns', () => {
    const config = insertedRows('BaseConfig')[0]!;
    assert.equal(config[0], 'config_ssc_cgl_t1');
    assert.ok(config.some((cell) => cell.startsWith('ARRAY[')));
  });
});

describe('the first super admin', () => {
  /** The failure this prevents: nothing in the application creates one, so there is no way in. */
  it('is a super admin, active, and scoped to every branch', () => {
    const admin = new RegExp('INSERT INTO "Admin"[\\s\\S]*?;').exec(SEED)![0];
    assert.match(admin, /'developer@iace\.co\.in'/);
    assert.match(admin, /true,\s*true,\s*true\s*\)/);
  });
});

describe('the SSC CGL catalog', () => {
  /**
   * Two tiers, not four: the 2022 revamp abolished the descriptive Tier 3 and the
   * DEST/CPT Tier 4, folding the skill test into Tier 2. Seeding the old shape would put
   * stages on screen that the exam does not have, under keys that are never reused.
   */
  it('carries the two tiers the exam actually has', () => {
    const stages = insertedRows('ExamStage');
    assert.deepEqual(
      stages.map((cells) => cells[2]),
      ['SSC_CGL_T1', 'SSC_CGL_T2'],
    );
  });

  it('orders them, because the UI sorts on it', () => {
    assert.deepEqual(
      insertedRows('ExamStage').map((cells) => cells[4]),
      ['1', '2'],
    );
  });

  /**
   * Disposition drives whether a stage can carry a mock. Tier 2 is PARTIAL because it is
   * compound: its objective modules can be sat, its DEST typing module cannot.
   */
  it('conducts Tier 1 outright and Tier 2 only in part', () => {
    const dispositions = Object.fromEntries(
      insertedRows('ExamStage').map((cells) => [cells[2], cells[6]]),
    );
    assert.deepEqual(dispositions, { SSC_CGL_T1: 'CONDUCTED', SSC_CGL_T2: 'PARTIAL' });
  });
});

describe('the SSC CGL Tier 1 default config', () => {
  const config = new RegExp('INSERT INTO "BaseConfig"[\\s\\S]*?;').exec(SEED)![0];

  it('is the stage default, so a new test starts from it', () => {
    assert.match(config, /'stage_ssc_cgl_t1', '[^']*', true,/);
  });

  /** SSC CGL renders both languages together; the student does not pick one. */
  it('renders English and Hindi together', () => {
    assert.match(config, /'DUAL'/);
    assert.match(config, /ARRAY\['EN', 'HI'\]::"SupportedLanguage"\[\]/);
  });

  it('is one free-navigation sitting of an hour', () => {
    assert.match(config, /3600, 'COMPOSITE_FREE', 'FREE'/);
  });

  /**
   * The failure this prevents: totalQuestions and totalMarks are a display cache, so a
   * section edited without them is a config that reports a paper it does not describe.
   */
  it('caches the totals its own sections add up to', () => {
    const sections = insertedRows('BaseConfigSection');
    const questions = sections.reduce((sum, cells) => sum + Number(cells[5]), 0);
    const marks = sections.reduce((sum, cells) => sum + Number(cells[5]) * Number(cells[6]), 0);

    const cached = /,\s*(\d+),\s*(\d+\.\d\d),\s*\n?\s*3600,/.exec(config);
    assert.ok(cached, 'the config does not state its cached totals');
    assert.equal(questions, Number(cached[1]));
    assert.equal(marks, Number(cached[2]));
  });

  it('has four merit sections of 25 questions at 2 marks, with 0.50 deducted', () => {
    const sections = insertedRows('BaseConfigSection');
    assert.equal(sections.length, 4);
    for (const cells of sections) {
      assert.equal(cells[5], '25');
      assert.equal(cells[6], '2.00');
      assert.equal(cells[7], '0.50');
      assert.equal(cells[9], 'MERIT');
    }
  });

  /** A null subject rolls every question up as unclassified, and the analytics say nothing. */
  it('names a subject for every section', () => {
    for (const cells of insertedRows('BaseConfigSection')) {
      assert.match(cells[4]!, /^subject_\w+$/);
    }
  });
});
