import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type FieldEffort, type SectionEffort } from '@iace/contracts';
import {
  EFFORT_RUNNERS,
  FIELD_SAMPLE_FLOOR,
  effortLine,
  paperEffort,
  sectionReadings,
} from '../src/handed-in';

const section = (id: string, attempted: number, total = 10): SectionEffort => ({
  id,
  name: id,
  total,
  attempted,
  unattempted: total - attempted,
  timeSpentSec: attempted * 30,
});

const figure = (baseConfigSectionId: string, attempted: number) => ({
  baseConfigSectionId,
  attempted,
  timeSpentSec: attempted * 20,
});

const field = (over: Partial<FieldEffort> = {}): FieldEffort => ({
  testId: 'tst_1',
  attemptNo: 1,
  cohortSize: 0,
  average: [],
  topper: null,
  previous: null,
  ...over,
});

describe('what a handed-in paper says of its own effort', () => {
  it('adds the sections up into the paper', () => {
    assert.deepEqual(paperEffort([section('a', 4), section('b', 7)]), {
      total: 20,
      attempted: 11,
      timeSpentSec: 330,
    });
  });

  it('leads with how many more were attempted than on the last attempt', () => {
    const before = field({ attemptNo: 2, previous: [figure('a', 3), figure('b', 2)] });
    assert.equal(
      effortLine([section('a', 6), section('b', 4)], before),
      '5 more attempted than your last attempt',
    );
  });

  it('says a paper answered in full is one', () => {
    assert.equal(
      effortLine([section('a', 10), section('b', 10)], field()),
      'Every question attempted',
    );
  });

  it('says so when more was attempted than the field averages', () => {
    const cohort = field({ cohortSize: 40, average: [figure('a', 4.5), figure('b', 3)] });
    assert.equal(
      effortLine([section('a', 6), section('b', 3)], cohort),
      'Attempted, above the field average',
    );
  });

  /** In a hall handing in together the first few marked are all the field there is, and they are not one. */
  it('does not measure anybody against a field of a few', () => {
    const early = field({
      cohortSize: FIELD_SAMPLE_FLOOR - 1,
      average: [figure('a', 2), figure('b', 2)],
    });

    assert.equal(effortLine([section('a', 6), section('b', 3)], early), 'Attempted');
    assert.deepEqual(
      sectionReadings(section('a', 6), early).map((row) => [row.runner, row.faint]),
      [
        [EFFORT_RUNNERS.YOU, false],
        [EFFORT_RUNNERS.FIELD, true],
      ],
    );
  });

  /** The failure this prevents: praise for a sitting that did less than last time, or less than the field. */
  it('names the figure and nothing more where nothing better is true', () => {
    const behind = field({
      attemptNo: 2,
      cohortSize: 40,
      previous: [figure('a', 8), figure('b', 8)],
      average: [figure('a', 7), figure('b', 7)],
    });
    assert.equal(effortLine([section('a', 5), section('b', 5)], behind), 'Attempted');
    assert.equal(effortLine([section('a', 5)], undefined), 'Attempted');
    assert.equal(effortLine([], field()), 'Attempted');
  });
});

describe('who one section stands beside', () => {
  it('reads you, your last attempt, the topper and the field, in that order', () => {
    const everyone = field({
      cohortSize: 40,
      previous: [figure('a', 3)],
      topper: [figure('a', 9)],
      average: [figure('a', 5.5)],
    });

    assert.deepEqual(
      sectionReadings(section('a', 6), everyone).map((row) => [
        row.runner,
        row.label,
        row.attempted,
      ]),
      [
        [EFFORT_RUNNERS.YOU, 'You', 6],
        [EFFORT_RUNNERS.PREVIOUS, 'Last attempt', 3],
        [EFFORT_RUNNERS.TOPPER, 'Topper', 9],
        [EFFORT_RUNNERS.FIELD, 'Field average', 5.5],
      ],
    );
  });

  /** A first sitter, and a read that never landed: the page still stands on the student's own row. */
  it('stands alone while there is nobody to stand beside', () => {
    assert.deepEqual(
      sectionReadings(section('a', 6), field()).map((row) => row.runner),
      [EFFORT_RUNNERS.YOU],
    );
    assert.deepEqual(
      sectionReadings(section('a', 6), undefined).map((row) => row.runner),
      [EFFORT_RUNNERS.YOU],
    );
  });

  it('leaves out a runner who has no figure for this section', () => {
    const elsewhere = field({
      cohortSize: 40,
      topper: [figure('b', 9)],
      average: [figure('a', 5)],
    });
    assert.deepEqual(
      sectionReadings(section('a', 6), elsewhere).map((row) => row.runner),
      [EFFORT_RUNNERS.YOU, EFFORT_RUNNERS.FIELD],
    );
  });
});
