import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  clockText,
  openSections,
  paletteCounts,
  secondsLeft,
  type ExamClock,
} from '../src/index';

const clock = (over: Partial<ExamClock> = {}): ExamClock => ({
  endsAt: '2026-09-01T06:00:00.000Z',
  serverNow: '2026-09-01T05:00:00.000Z',
  arrivedAt: 1_000_000,
  ...over,
});

describe('secondsLeft', () => {
  it('counts the sitting the server granted, not the wall clock', () => {
    assert.equal(secondsLeft(clock(), 1_000_000), 3600);
  });

  it('ticks down with the page, second by second', () => {
    assert.equal(secondsLeft(clock(), 1_000_000 + 90_000), 3510);
  });

  /** The failure this prevents: a device set an hour fast handing back a sitting an hour short. */
  it('ignores a device clock that disagrees with the server', () => {
    const skewed = clock({ arrivedAt: 9_999_999_999 });

    assert.equal(secondsLeft(skewed, 9_999_999_999), 3600);
  });

  it('floors at zero rather than running negative', () => {
    assert.equal(secondsLeft(clock(), 1_000_000 + 7_200_000), 0);
  });

  /** A reload mid-sitting must recover the time left, not restart it. */
  it('recovers the same remaining time from a fresh paper', () => {
    const resumed = clock({ serverNow: '2026-09-01T05:40:00.000Z', arrivedAt: 5_000_000 });

    assert.equal(secondsLeft(resumed, 5_000_000), 1200);
  });
});

describe('clockText', () => {
  it('drops the hour once there is none left', () => {
    assert.equal(clockText(3723), '1:02:03');
    assert.equal(clockText(598), '09:58');
    assert.equal(clockText(0), '00:00');
  });
});

describe('paletteCounts', () => {
  it('counts every question exactly once', () => {
    const counts = paletteCounts(['q1', 'q2', 'q3', 'q4'], {
      q1: { state: ANSWER_STATE.ANSWERED },
      q2: { state: ANSWER_STATE.ANSWERED_MARKED },
      q3: { state: ANSWER_STATE.NOT_ANSWERED },
    });

    assert.equal(counts.ANSWERED, 1);
    assert.equal(counts.ANSWERED_MARKED, 1);
    assert.equal(counts.NOT_ANSWERED, 1);
    // The one the state map never mentions is the one nobody has opened.
    assert.equal(counts.NOT_VISITED, 1);
    assert.equal(
      Object.values(counts).reduce((sum, n) => sum + n, 0),
      4,
    );
  });
});

describe('openSections', () => {
  const sections = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('opens every section under one composite clock', () => {
    assert.deepEqual(openSections(sections, false, {}), ['a', 'b', 'c']);
  });

  /** The failure this prevents: a sectional paper letting a student back into a closed section. */
  it('opens only the current one under a sectional clock', () => {
    assert.deepEqual(openSections(sections, true, { a: { closed: true } }), ['b']);
  });

  it('opens nothing once every section has closed', () => {
    const allClosed = { a: { closed: true }, b: { closed: true }, c: { closed: true } };

    assert.deepEqual(openSections(sections, true, allClosed), []);
  });
});
