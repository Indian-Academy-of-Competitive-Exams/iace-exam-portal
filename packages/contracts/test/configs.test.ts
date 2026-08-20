import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { baseConfigSchema } from '../src/index';

describe('baseConfigSchema', () => {
  const config = {
    id: 'c1',
    examStageId: 's1',
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
