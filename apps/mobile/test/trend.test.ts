import test from 'node:test';
import assert from 'node:assert/strict';
import { plotRuns } from '../src/lib/trend';

test('the line breaks at an unranked sitting rather than drawing through it', () => {
  const runs = plotRuns([
    { key: 'a', value: 10 },
    { key: 'b', value: 20 },
    { key: 'c', value: null },
    { key: 'd', value: 30 },
    { key: 'e', value: 40 },
  ]);

  assert.deepEqual(runs, [
    [0, 1],
    [3, 4],
  ]);
});

test('a lone measured point draws no segment of its own', () => {
  assert.deepEqual(plotRuns([{ key: 'a', value: 10 }]), []);
  assert.deepEqual(
    plotRuns([
      { key: 'a', value: 10 },
      { key: 'b', value: null },
      { key: 'c', value: 30 },
    ]),
    [],
  );
});
