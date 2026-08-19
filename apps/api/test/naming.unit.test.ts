import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { branchNameSchema, canonicalName, groupNameSchema } from '@iace/contracts';

/**
 * Branch and group names are the vocabulary access is routed through, and the failure these rules
 * exist to prevent is the near-duplicate: two rows that mean one thing, that no uniqueness check
 * catches, and that quietly split a batch in half.
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

describe('groupNameSchema', () => {
  it('accepts a canonical name unchanged', () => {
    assert.equal(groupNameSchema.parse('SSC CGL MORNING'), 'SSC CGL MORNING');
  });

  it('normalises rather than rejecting what it can tidy', () => {
    assert.equal(groupNameSchema.parse('  ssc  cgl   morning '), 'SSC CGL MORNING');
  });

  it('allows digits, which batch names are full of', () => {
    assert.equal(groupNameSchema.parse('rrb je 2026 b2'), 'RRB JE 2026 B2');
  });

  it('refuses punctuation, which cannot be tidied into anything', () => {
    for (const name of ['SSC-CGL MORNING', 'SSC CGL (MORNING)', 'SSC CGL, MORNING', 'BATCH #1']) {
      const result = groupNameSchema.safeParse(name);
      assert.equal(result.success, false, `expected "${name}" to be refused`);
      assert.match(
        result.error?.issues[0]?.message ?? '',
        /capital letters, numbers and single spaces/,
      );
    }
  });

  it('refuses a name that is only whitespace', () => {
    assert.equal(groupNameSchema.safeParse('   ').success, false);
  });

  it('measures length AFTER normalising, so padding cannot smuggle one past', () => {
    const tooLong = 'A'.repeat(81);
    assert.equal(groupNameSchema.safeParse(tooLong).success, false);
    // 80 characters plus padding is still 80 characters.
    assert.equal(groupNameSchema.parse(`  ${'A'.repeat(80)}  `), 'A'.repeat(80));
  });

  it('makes case-different duplicates impossible rather than merely reported', () => {
    const typedByOne = groupNameSchema.parse('SSC CGL Morning');
    const typedByAnother = groupNameSchema.parse('ssc cgl  MORNING ');
    assert.equal(typedByOne, typedByAnother);
  });
});

describe('branchNameSchema', () => {
  it('normalises a branch the same way a group is normalised', () => {
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
