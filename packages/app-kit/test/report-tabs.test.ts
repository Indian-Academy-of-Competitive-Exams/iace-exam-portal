import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPORT_TABS, latestSitting, newestFirst, reportTabOf } from '../src/report-tabs';

const BASE = '/attempts/att_1/report';

describe('reportTabOf', () => {
  it('reads the tab a deep link names', () => {
    assert.equal(reportTabOf(`${BASE}/questions`, BASE), 'questions');
    assert.equal(reportTabOf(`${BASE}/solutions`, BASE), 'solutions');
    assert.equal(reportTabOf(`${BASE}/compare`, BASE), 'compare');
  });

  /** The shell's own path is the score card, which is why that tab has no segment of its own. */
  it('reads the shell itself as the score card', () => {
    assert.equal(reportTabOf(BASE, BASE), '');
    assert.equal(reportTabOf(`${BASE}/`, BASE), '');
  });

  /** A tab nobody built is not a blank screen: it falls back to the one every report has. */
  it('falls back to the score card for a segment no tab claims', () => {
    assert.equal(reportTabOf(`${BASE}/cutoffs`, BASE), '');
    assert.equal(reportTabOf('/somewhere/else', BASE), '');
  });

  it('names every tab exactly once, so no two triggers answer to one path', () => {
    const paths = REPORT_TABS.map((tab) => tab.path);
    assert.equal(new Set(paths).size, paths.length);
  });
});

describe('latestSitting', () => {
  /** The trend runs oldest to newest, so the last point is the test they just sat. */
  it('takes the newest sitting from an oldest-first trend', () => {
    assert.deepEqual(latestSitting([{ id: 'old' }, { id: 'new' }]), { id: 'new' });
  });

  /** Nobody has sat anything, which is an empty state rather than a report of nothing. */
  it('has nothing to open where nothing was sat', () => {
    assert.equal(latestSitting([]), null);
  });
});

describe('newestFirst', () => {
  it('turns the chart order into the picker order, leaving the caller array alone', () => {
    const points = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    assert.deepEqual(
      newestFirst(points).map((point) => point.id),
      ['c', 'b', 'a'],
    );
    assert.deepEqual(
      points.map((point) => point.id),
      ['a', 'b', 'c'],
    );
  });
});
