import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_KEYS, type SatSitting } from '@iace/contracts';
import { DOWNLOAD_KINDS, downloadChoices, downloadOf } from '../src/report-downloads';

const TODAY = '2026-10-08';

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

const SITTINGS = [
  sitting('1', '2026-09-01T10:00:00.000Z'),
  sitting('2', '2026-09-08T10:00:00.000Z'),
];

test('downloadChoices offers the weeks newest first, each valued by its Monday', () => {
  const [thisWeek, lastWeek, before] = downloadChoices(DOWNLOAD_KINDS.WEEKLY, [], TODAY);

  assert.deepEqual(thisWeek, { value: '', label: 'This week · 5 Oct 2026 to 11 Oct 2026' });
  assert.deepEqual(lastWeek, {
    value: '2026-09-28',
    label: 'Last week · 28 Sept 2026 to 4 Oct 2026',
  });
  assert.deepEqual(before, { value: '2026-09-21', label: '21 Sept 2026 to 27 Sept 2026' });
});

test('downloadChoices steps the months back across a year’s end', () => {
  const months = downloadChoices(DOWNLOAD_KINDS.MONTHLY, [], '2026-02-10');

  assert.deepEqual(
    months.slice(0, 3).map((month) => month.value),
    ['', '2026-01-01', '2025-12-01'],
  );
});

test('downloadChoices lists the newest sitting first, and a kind with nothing to pick offers nothing', () => {
  assert.deepEqual(downloadChoices(DOWNLOAD_KINDS.TEST, SITTINGS, TODAY), [
    { value: '', label: 'Mock 2 · 8 Sept 2026 · 120 / 200' },
    { value: '1', label: 'Mock 1 · 1 Sept 2026 · 120 / 200' },
  ]);
  assert.deepEqual(downloadChoices(DOWNLOAD_KINDS.TOPICS, SITTINGS, TODAY), []);
});

test('downloadOf asks for the week or the month the chosen day falls in, and for this one when none is chosen', () => {
  assert.deepEqual(downloadOf(DOWNLOAD_KINDS.WEEKLY, '', [], TODAY), {
    key: REPORT_KEYS.STUDENT_WEEKLY,
    query: { from: '2026-10-05', to: '2026-10-11' },
  });
  assert.deepEqual(downloadOf(DOWNLOAD_KINDS.MONTHLY, '2026-09-01', [], TODAY), {
    key: REPORT_KEYS.STUDENT_MONTHLY,
    query: { from: '2026-09-01', to: '2026-09-30' },
  });
});

test('downloadOf reads a day that is no day as today, rather than throwing on an address somebody typed', () => {
  assert.deepEqual(downloadOf(DOWNLOAD_KINDS.WEEKLY, 'last-tuesday', [], TODAY)?.query, {
    from: '2026-10-05',
    to: '2026-10-11',
  });
});

test('downloadOf names the newest sitting until one is chosen, and asks for nothing while there is none', () => {
  assert.deepEqual(downloadOf(DOWNLOAD_KINDS.TEST, '', SITTINGS, TODAY), {
    key: REPORT_KEYS.STUDENT_SCORE_CARD,
    query: { attemptId: '2' },
  });
  assert.deepEqual(downloadOf(DOWNLOAD_KINDS.TEST, '1', SITTINGS, TODAY)?.query, {
    attemptId: '1',
  });
  assert.equal(downloadOf(DOWNLOAD_KINDS.TEST, '', [], TODAY), null);
});

test('downloadOf falls back to the newest sitting once the chosen one is no longer among them', () => {
  assert.deepEqual(downloadOf(DOWNLOAD_KINDS.TEST, 'voided', SITTINGS, TODAY)?.query, {
    attemptId: '2',
  });
  assert.equal(downloadOf(DOWNLOAD_KINDS.TEST, 'voided', [], TODAY), null);
});
