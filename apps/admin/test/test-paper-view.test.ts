import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAPER_BINDING } from '@iace/contracts';
import {
  canPickPaper,
  hasPaper,
  paperOptions,
  SECTION_FULLNESS,
  sectionFullness,
  sectionTally,
  type PaperSource,
} from '../src/routes/test-paper-view';

const fixed = (over: Partial<PaperSource> = {}): PaperSource => ({
  paperBinding: PAPER_BINDING.FIXED,
  isLocked: false,
  variantCount: 1,
  ...over,
});

const generated = (over: Partial<PaperSource> = {}): PaperSource => ({
  paperBinding: PAPER_BINDING.GENERATED,
  isLocked: false,
  variantCount: 10,
  ...over,
});

describe('whether a test holds a paper to read', () => {
  it('has one from the first question a hand-picked test is given', () => {
    assert.equal(hasPaper(fixed()), true);
    assert.equal(hasPaper(fixed({ isLocked: true })), true);
  });

  it('has none until a drawn test is frozen, so nothing about it is short', () => {
    assert.equal(hasPaper(generated()), false);
  });

  it('has them the moment the finalize draws them', () => {
    assert.equal(hasPaper(generated({ isLocked: true })), true);
  });
});

describe('whether there are papers to page through', () => {
  it('offers no choice before they are drawn', () => {
    assert.equal(canPickPaper(generated()), false);
  });

  it('offers one once a drawn test is frozen', () => {
    assert.equal(canPickPaper(generated({ isLocked: true })), true);
  });

  it('offers none where a drawn test drew a single paper', () => {
    assert.equal(canPickPaper(generated({ isLocked: true, variantCount: 1 })), false);
  });

  it('offers none to a hand-picked test, which has only ever had the one', () => {
    assert.equal(canPickPaper(fixed()), false);
    assert.equal(canPickPaper(fixed({ isLocked: true })), false);
  });
});

describe('the papers offered by name', () => {
  it('names paper N for variant N minus one, never a paper zero', () => {
    const options = paperOptions(10);

    assert.equal(options.length, 10);
    assert.deepEqual(options[0], { value: '0', label: 'Paper 1' });
    assert.equal(
      options.every((option) => option.label === `Paper ${Number(option.value) + 1}`),
      true,
    );
    assert.equal(
      options.some((option) => option.label === 'Paper 0'),
      false,
    );
  });

  it('reaches the last paper a test drew', () => {
    assert.deepEqual(paperOptions(10).at(-1), { value: '9', label: 'Paper 10' });
    assert.deepEqual(paperOptions(1), [{ value: '0', label: 'Paper 1' }]);
  });
});

describe('sectionFullness', () => {
  const section = { id: 'sec_1', questionCount: 25 };

  /** Untouched is not the same as part-built: a fresh test must not read as five warnings. */
  it('separates untouched from short from full', () => {
    assert.equal(sectionFullness(section, new Map()), SECTION_FULLNESS.EMPTY);
    assert.equal(sectionFullness(section, new Map([['sec_1', 0]])), SECTION_FULLNESS.EMPTY);
    assert.equal(sectionFullness(section, new Map([['sec_1', 12]])), SECTION_FULLNESS.SHORT);
    assert.equal(sectionFullness(section, new Map([['sec_1', 25]])), SECTION_FULLNESS.FULL);
  });

  /** A paper over its count is not short of anything, whatever put it there. */
  it('counts a section past its own count as full', () => {
    assert.equal(sectionFullness(section, new Map([['sec_1', 26]])), SECTION_FULLNESS.FULL);
  });

  /** THE failure this prevents: a drawn test judged short before anything has been drawn for it. */
  it('judges nothing before a paper exists', () => {
    assert.equal(sectionFullness(section, null), null);
    assert.equal(sectionTally(section, null), null);
  });
});

describe('sectionTally', () => {
  const section = { id: 'sec_1', questionCount: 25 };

  it('reads what the section holds against what it owes', () => {
    assert.equal(sectionTally(section, new Map([['sec_1', 12]])), '12/25');
  });

  /** A section the paper has no row for holds zero, not nothing measurable. */
  it('reads zero for a section the paper has no row for', () => {
    assert.equal(sectionTally(section, new Map()), '0/25');
  });
});
