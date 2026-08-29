import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXAM_CODE_MAX, branchNameSchema, canonicalName, examCodeSchema } from '@iace/contracts';

/**
 * Branch names and exam codes are the vocabulary access is routed through, and the failure these
 * rules exist to prevent is the near-duplicate: two rows that mean one thing, that no uniqueness
 * check catches, and that quietly split a cohort in half.
 */
describe('canonicalName — one spelling per name', () => {
  it('folds case, so a name cannot be entered twice by shouting', () => {
    assert.equal(canonicalName('ssc cgl morning'), 'SSC CGL MORNING');
    assert.equal(canonicalName('Ssc Cgl Morning'), 'SSC CGL MORNING');
  });

  it('collapses runs of whitespace to a single space', () => {
    assert.equal(canonicalName('SSC   CGL\tMORNING'), 'SSC CGL MORNING');
  });

  it('trims, so a trailing space cannot make a second row', () => {
    assert.equal(canonicalName('  SSC CGL MORNING  '), 'SSC CGL MORNING');
  });

  it('is idempotent — normalising a canonical name changes nothing', () => {
    const once = canonicalName('  ssc   cgl morning ');
    assert.equal(canonicalName(once), once);
  });
});

describe('examCodeSchema', () => {
  it('accepts a canonical name unchanged', () => {
    assert.equal(examCodeSchema.parse('SSC CGL TIER 1'), 'SSC CGL TIER 1');
  });

  it('normalises rather than rejecting what it can tidy', () => {
    assert.equal(examCodeSchema.parse('  ssc  cgl   tier 1 '), 'SSC CGL TIER 1');
  });

  it('allows digits, which exam codes are full of', () => {
    assert.equal(examCodeSchema.parse('rrb je 2026 b2'), 'RRB JE 2026 B2');
  });

  it('refuses punctuation, which cannot be tidied into anything', () => {
    for (const name of ['SSC-CGL', 'SSC CGL (T1)', 'SSC CGL, T1', 'EXAM #1']) {
      const result = examCodeSchema.safeParse(name);
      assert.equal(result.success, false, `expected "${name}" to be refused`);
      assert.match(
        result.error?.issues[0]?.message ?? '',
        /capital letters, numbers and single spaces/,
      );
    }
  });

  it('refuses a name that is only whitespace', () => {
    assert.equal(examCodeSchema.safeParse('   ').success, false);
  });

  it('measures length AFTER normalising, so padding cannot smuggle one past', () => {
    assert.equal(examCodeSchema.safeParse('A'.repeat(EXAM_CODE_MAX + 1)).success, false);
    const atCap = 'A'.repeat(EXAM_CODE_MAX);
    assert.equal(examCodeSchema.parse(`  ${atCap}  `), atCap);
  });

  it('makes case-different duplicates impossible rather than merely reported', () => {
    const typedByOne = examCodeSchema.parse('SSC CGL Tier 1');
    const typedByAnother = examCodeSchema.parse('ssc cgl  TIER 1 ');
    assert.equal(typedByOne, typedByAnother);
  });
});

describe('branchNameSchema', () => {
  it('normalises a branch the same way an exam code is normalised', () => {
    assert.equal(branchNameSchema.parse(' ameerpet '), 'AMEERPET');
    assert.equal(branchNameSchema.parse('rtc  x roads'), 'RTC X ROADS');
  });

  it('refuses a branch name longer than 60 characters', () => {
    assert.equal(branchNameSchema.safeParse('A'.repeat(61)).success, false);
  });

  it('leaves an already-canonical name unchanged', () => {
    assert.equal(branchNameSchema.parse('ONLINE'), 'ONLINE');
  });
});
