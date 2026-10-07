import test from 'node:test';
import assert from 'node:assert/strict';
import { activeFilterCount, offeredValues, summaryOf, type FilterSpec } from '../src/lib/filters';

const specOf = (subjects: readonly string[], series: readonly string[]): FilterSpec[] => [
  { key: 'q', kind: 'search', label: 'Search' },
  {
    key: 'subjectId',
    kind: 'multi',
    label: 'Subject',
    items: subjects.map((value) => ({ value, label: `Subject ${value}` })),
  },
  {
    key: 'series',
    kind: 'choice',
    label: 'Series',
    items: [
      { value: '', label: 'Any series' },
      ...series.map((value) => ({ value, label: `Series ${value}` })),
    ],
  },
];

const SET = { q: 'ratio', subjectId: ['maths', 'reasoning'], series: 'tier-1' };

test('values the spec still offers are untouched', () => {
  const filters = specOf(['maths', 'reasoning'], ['tier-1']);

  assert.deepEqual(offeredValues(SET, filters), SET);
});

/** The defect this pins: the last question of a subject is removed and its id stays set with no chip to untick. */
test('a subject no longer offered is dropped from the set, and the rest of the set stays', () => {
  const filters = specOf(['maths'], ['tier-1']);
  const values = offeredValues(SET, filters);

  assert.deepEqual(values.subjectId, ['maths']);
  assert.deepEqual(summaryOf(filters, values), ['Subject maths', 'Series tier-1']);
});

test('a series no longer reached stops filtering, counting and reading as a raw id', () => {
  const filters = specOf([], []);
  const values = offeredValues(SET, filters);

  assert.deepEqual(values, { q: 'ratio', subjectId: [] });
  assert.equal(activeFilterCount(values, filters), 1);
  assert.deepEqual(summaryOf(filters, values), []);
});
