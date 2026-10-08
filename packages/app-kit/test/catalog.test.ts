import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppException,
  ErrorCodes,
  TEST_SERIES_KIND,
  TEST_SHUT,
  TIMER_TEMPLATE,
  type SatSitting,
  type StudentCatalogSeries,
  type StudentCatalogTest,
} from '@iace/contracts';
import {
  EMPTINESS,
  SHUT_SAYS,
  emptyReason,
  everySitting,
  isBriefRefused,
  minutes,
  resultsByTest,
  shutOf,
  shutReason,
} from '../src/catalog';
import { isSectionalPaper } from '../src/student-figures';

test('a brief the server will not show this student is a refusal', () => {
  assert.equal(isBriefRefused(new AppException(ErrorCodes.NOT_FOUND)), true, 'an unreachable test');
  assert.equal(isBriefRefused(new AppException(ErrorCodes.FORBIDDEN)), true, 'not a student');
});

test('a brief that failed to arrive is not a refusal, so the gate offers a retry', () => {
  const offline = new AppException(ErrorCodes.INTERNAL, 'Cannot reach the server.', {
    httpStatus: 0,
  });
  assert.equal(isBriefRefused(offline), false, 'no network');
  assert.equal(isBriefRefused(new AppException(ErrorCodes.INTERNAL)), false, 'a 5xx');
  assert.equal(isBriefRefused(new AppException(ErrorCodes.SERVICE_UNAVAILABLE)), false);
  assert.equal(isBriefRefused(new AppException(ErrorCodes.RATE_LIMITED)), false);
  assert.equal(isBriefRefused(new Error('socket hang up')), false);
  assert.equal(isBriefRefused({ code: ErrorCodes.NOT_FOUND }), false, 'a look-alike is not one');
});

const satOn = (attemptId: string, testId: string): SatSitting => ({
  attemptId,
  attemptNo: 1,
  isGraded: true,
  testId,
  testTitle: 'A paper',
  submittedAt: '2026-09-01T10:00:00.000Z',
  score: 40,
  maxMarks: 100,
  percentage: 40,
  accuracy: 80,
});

test('every sitting reaches a tile, and only the charted ones carry a standing', () => {
  const old = satOn('old', 'paper-a');
  const recent = satOn('recent', 'paper-b');
  const trend = {
    testsSat: 2,
    points: [{ ...recent, rank: 3, percentile: 91 }],
    sittings: [old, recent],
  };

  const results = resultsByTest(everySitting(trend));

  assert.deepEqual(results.get('paper-a'), {
    attemptId: 'old',
    score: 40,
    maxMarks: 100,
    percentile: null,
  });
  assert.equal(results.get('paper-b')?.percentile, 91);
  assert.deepEqual(everySitting(undefined), []);
});

test('minutes reads a time in whole seconds under a minute and whole minutes from there', () => {
  assert.equal(minutes(43.6667), '44s');
  assert.equal(minutes(59.6), '1m');
  assert.equal(minutes(45), '45s');
  assert.equal(minutes(125), '2m');
  assert.equal(minutes(null), '—');
});

const listed = (over: Partial<StudentCatalogTest> = {}): StudentCatalogTest => ({
  id: 'tst_1',
  title: 'Mock 1',
  durationSec: 3600,
  sectionCount: 1,
  totalQuestions: 100,
  order: 1,
  opensAt: null,
  attemptStatus: null,
  canStart: false,
  ...over,
});

const seriesOf = (tests: StudentCatalogTest[]): StudentCatalogSeries => ({
  id: 'srs_1',
  name: 'Mocks',
  examStage: null,
  kind: TEST_SERIES_KIND.FREE,
  sequentialTests: false,
  tests,
});

const NOW = new Date('2026-06-01T00:00:00.000Z');
const OPENED = '2026-05-01T00:00:00.000Z';
const AHEAD = '2026-07-01T00:00:00.000Z';

test('a shut test says the fact the server named, whatever this device makes of the time', () => {
  const said = (over: Partial<StudentCatalogTest>) => shutReason(listed(over), NOW);

  assert.equal(said({ shut: TEST_SHUT.HOLD }), 'Test access on hold');
  assert.equal(said({ shut: TEST_SHUT.TURN, opensAt: AHEAD }), 'Waiting its turn');
  assert.equal(said({ shut: TEST_SHUT.NOT_OPEN, opensAt: OPENED }), 'Not open yet');
  assert.match(SHUT_SAYS[shutOf(listed({ shut: TEST_SHUT.HOLD }), NOW)].notice, /on hold/);
});

test('a shut test from a server that names no reason is still read off the opening', () => {
  assert.equal(shutOf(listed({ opensAt: AHEAD }), NOW), TEST_SHUT.NOT_OPEN);
  assert.equal(shutOf(listed({ opensAt: OPENED }), NOW), TEST_SHUT.TURN);
  assert.equal(shutOf(listed({ opensAt: null }), NOW), TEST_SHUT.TURN);
});

test('no tests yet is counted in tests, so a reached series holding none is not a filter', () => {
  assert.equal(emptyReason([], 0), EMPTINESS.NONE, 'reaches no series');
  assert.equal(emptyReason([seriesOf([])], 0), EMPTINESS.NONE, 'reaches a series with no tests');
  assert.equal(emptyReason([seriesOf([listed()])], 0), EMPTINESS.FILTERED, 'a search hid them');
  assert.equal(emptyReason([seriesOf([listed()])], 1), null);
});

test('a paper is sectional by its timer, not by its sections carrying durations', () => {
  const sections = [{ durationSec: 1200 }];

  assert.equal(isSectionalPaper({ timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE, sections }), false);
  assert.equal(
    isSectionalPaper({ timerTemplate: TIMER_TEMPLATE.SECTIONAL_LOCKED, sections }),
    true,
  );
  assert.equal(isSectionalPaper({ sections }), true, 'an older server names no timer');
  assert.equal(isSectionalPaper({ sections: [{ durationSec: null }] }), false);
});
