import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAPER_BINDING } from '@iace/contracts';
import {
  canPickPaper,
  hasPaper,
  paperOptions,
  sectionTabLabel,
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

describe('sectionTabLabel', () => {
  const section = { id: 'sec_1', name: 'Quantitative Aptitude', questionCount: 25 };

  it('carries the tally, so which sections are short reads off the strip', () => {
    assert.equal(sectionTabLabel(section, new Map([['sec_1', 12]])), 'Quantitative Aptitude 12/25');
    assert.equal(sectionTabLabel(section, new Map([['sec_1', 25]])), 'Quantitative Aptitude 25/25');
  });

  /** A section the paper holds nothing for is at zero, not unmeasured. */
  it('reads zero for a section the paper has no row for', () => {
    assert.equal(sectionTabLabel(section, new Map()), 'Quantitative Aptitude 0/25');
  });

  /** THE failure this prevents: a drawn test reading "0/25" as though nobody had built it. */
  it('names the section alone before any paper exists', () => {
    assert.equal(sectionTabLabel(section, null), 'Quantitative Aptitude');
  });
});
