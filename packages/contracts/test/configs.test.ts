import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseConfigSchema,
  configTotalsOf,
  createBaseConfigSchema,
  updateBaseConfigSchema,
  EXAM_FAMILY,
} from '../src/index';

describe('baseConfigSchema', () => {
  const config = {
    id: 'c1',
    examStageId: 's1',
    examStage: {
      id: 's1',
      stageKey: 'SSC_CGL_T1',
      name: 'Tier 1',
      exam: { id: 'e1', code: 'SSC CGL', name: 'SSC CGL', family: EXAM_FAMILY.SSC },
    },
    name: 'SSC CGL Tier 1',
    isDefault: true,
    clonedFromId: null,
    version: 1,
    isActive: true,
    locked: false,
    totalQuestions: 100,
    totalMarks: 200,
    durationSec: 3600,
    timerTemplate: 'COMPOSITE_FREE',
    navigation: 'FREE',
    optionalSectionCount: null,
    defaultTestUi: 'CBT',
    languageMode: 'DUAL',
    languages: ['EN', 'HI'],
    shuffleQuestions: true,
    shuffleOptions: true,
    calculatorEnabled: false,
    scoringVersion: 1,
    testCount: 0,
    createdAt: '2026-08-20T00:00:00.000Z',
  };

  it('reads a config that names its languages', () => {
    assert.deepEqual(baseConfigSchema.parse(config).languages, ['EN', 'HI']);
  });

  /**
   * The database enum is uppercase; the lowercase keys in `SUPPORTED_LANGUAGES` are the
   * ones inside question content JSON, and they are not interchangeable.
   */
  it('refuses a content-JSON language key where the column value belongs', () => {
    assert.equal(baseConfigSchema.safeParse({ ...config, languages: ['en'] }).success, false);
  });
});

describe('the config write contracts', () => {
  const section = {
    name: 'A',
    order: 1,
    questionCount: 25,
    marksPerQuestion: 2,
    negativeMarks: 0.5,
  };
  const draft = { examStageId: 's1', name: 'Tier 1', durationSec: 3600, sections: [section] };

  it('coerces the numbers a form field hands over as strings', () => {
    const parsed = createBaseConfigSchema.parse({
      ...draft,
      durationSec: '3600',
      sections: [{ ...section, order: '1', questionCount: '25', marksPerQuestion: '2' }],
    });

    assert.equal(parsed.durationSec, 3600);
    assert.equal(parsed.sections[0]?.questionCount, 25);
  });

  /** A paper with no sections is not a paper — the totals it caches would both be zero. */
  it('refuses a config with no sections at all', () => {
    assert.equal(createBaseConfigSchema.safeParse({ ...draft, sections: [] }).success, false);
  });

  /** The totals are a cache the server computes; nothing is allowed to type them. */
  it('has no way to state the totals by hand', () => {
    const parsed = createBaseConfigSchema.parse({
      ...draft,
      totalQuestions: 999,
      totalMarks: 999,
    });

    assert.equal('totalQuestions' in parsed, false);
    assert.equal('totalMarks' in parsed, false);
  });

  it('adds the totals up the way the server does', () => {
    assert.deepEqual(
      configTotalsOf([
        { ...section, questionCount: 25, marksPerQuestion: 2 },
        { ...section, order: 2, questionCount: 10, marksPerQuestion: 4 },
      ]),
      { totalQuestions: 35, totalMarks: 90 },
    );
  });

  it('takes a patch with nothing but a name, so a locked config can still be renamed', () => {
    assert.deepEqual(updateBaseConfigSchema.parse({ name: 'Tier 1 (2025)' }), {
      name: 'Tier 1 (2025)',
    });
  });
});
