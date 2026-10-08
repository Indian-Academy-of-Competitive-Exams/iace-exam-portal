import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseConfigSchema,
  configTotalsOf,
  createBaseConfigSchema,
  updateBaseConfigSchema,
  EXAM_COURSE,
  LANGUAGE_CODE,
} from '../src/index';

describe('baseConfigSchema', () => {
  const config = {
    id: 'c1',
    examStageId: 's1',
    examStage: {
      id: 's1',
      stageKey: 'SSC_CGL_T1',
      name: 'Tier 1',
      exam: { id: 'e1', code: 'SSC CGL', name: 'SSC CGL', course: EXAM_COURSE.SSC },
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
    examTemplate: 'DEFAULT',
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

  /** The database enum is uppercase; the lowercase keys in `SUPPORTED_LANGUAGES` are for question content JSON, and the two are not interchangeable. */
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
  const draft = {
    examStageId: 's1',
    name: 'Tier 1',
    durationSec: 3600,
    languages: [LANGUAGE_CODE.EN],
    sections: [section],
  };

  /** The field each refusal is keyed to, which is where the form shows it. */
  const refusedAt = (input: unknown) =>
    createBaseConfigSchema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ??
    [];

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

  /** The failure this prevents: 0.1 + 0.1 + 0.1 on screen as 0.30000000000000004. */
  it('adds marks up as marks, to two places', () => {
    const { totalMarks } = configTotalsOf([
      { ...section, questionCount: 3, marksPerQuestion: 0.1 },
    ]);

    assert.equal(totalMarks, 0.3);
  });

  /** The failure this prevents: 40,000,000 minutes overflowing the integer column as a 500. */
  it('refuses a clock longer than a day, on the paper, a section, a session and a question', () => {
    const tooLong = 40_000_000 * 60;

    assert.deepEqual(refusedAt({ ...draft, durationSec: tooLong }), ['durationSec']);
    assert.deepEqual(refusedAt({ ...draft, sections: [{ ...section, durationSec: tooLong }] }), [
      'sections.0.durationSec',
    ]);
    assert.deepEqual(refusedAt({ ...draft, sections: [{ ...section, perQuestionSec: tooLong }] }), [
      'sections.0.perQuestionSec',
    ]);
    assert.deepEqual(
      refusedAt({ ...draft, modules: [{ name: 'Session 1', order: 0, durationSec: tooLong }] }),
      ['modules.0.durationSec'],
    );
    assert.deepEqual(refusedAt({ ...draft, durationSec: 24 * 60 * 60 }), []);
  });

  /** The failure this prevents: a paper stored with no language, which no student can begin. */
  it('refuses a paper offered in no language, created or edited', () => {
    const { languages: _languages, ...unsaid } = draft;

    assert.deepEqual(refusedAt({ ...draft, languages: [] }), ['languages']);
    assert.deepEqual(refusedAt(unsaid), ['languages']);
    assert.equal(updateBaseConfigSchema.safeParse({ languages: [] }).success, false);
  });

  it('names a session the way the screen does', () => {
    const { error } = createBaseConfigSchema.safeParse({
      ...draft,
      modules: [{ name: '', order: 0 }],
    });

    assert.deepEqual(
      error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
      [['modules.0.name', 'Give the session a name']],
    );
  });

  it('takes a patch with nothing but a name, so a locked config can still be renamed', () => {
    assert.deepEqual(updateBaseConfigSchema.parse({ name: 'Tier 1 (2025)' }), {
      name: 'Tier 1 (2025)',
    });
  });
});
