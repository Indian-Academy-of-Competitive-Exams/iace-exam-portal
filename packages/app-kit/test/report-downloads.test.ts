import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_KEYS, type SatSitting } from '@iace/contracts';
import { progressDownloads, scoreCardDownloads } from '../src/report-downloads';

test('progressDownloads dates each named period off the day it is asked on', () => {
  const [thisWeek, lastWeek, thisMonth] = progressDownloads('2026-10-08');

  assert.deepEqual(thisWeek?.query, { from: '2026-10-05', to: '2026-10-11' });
  assert.equal(thisWeek?.meta, '5 Oct 2026 to 11 Oct 2026');
  assert.deepEqual(lastWeek?.query, { from: '2026-09-28', to: '2026-10-04' });
  assert.equal(thisMonth?.key, REPORT_KEYS.STUDENT_MONTHLY);
});

test('scoreCardDownloads lists the newest sitting first, each asked for by its own id', () => {
  const sitting = (attemptId: string, submittedAt: string): SatSitting => ({
    attemptId,
    attemptNo: 1,
    isGraded: true,
    testId: `t-${attemptId}`,
    testTitle: `Mock ${attemptId}`,
    submittedAt,
    score: 120,
    maxMarks: 200,
    percentage: 60,
    accuracy: 70,
  });

  const cards = scoreCardDownloads([
    sitting('1', '2026-09-01T10:00:00.000Z'),
    sitting('2', '2026-09-08T10:00:00.000Z'),
  ]);

  assert.deepEqual(
    cards.map((card) => [card.title, card.meta, card.query]),
    [
      ['Mock 2', '8 Sept 2026 · 120 / 200', { attemptId: '2' }],
      ['Mock 1', '1 Sept 2026 · 120 / 200', { attemptId: '1' }],
    ],
  );
});
