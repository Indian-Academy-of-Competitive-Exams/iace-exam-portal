import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  AppException,
  ErrorCodes,
  instituteDayLabel,
  type PerformancePoint,
  type ScoreCard,
} from '@iace/contracts';
import { MARKING_TRIES } from '@iace/app-kit';
import './support/offline';
import { api } from '../src/lib/api';
import { SubjectPanel } from '../src/features/performance/subject-report';
import { ComparePanel } from '../src/features/performance/compare';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({
  // No delay, because a marked paper's read asks again by itself whatever the client's default is.
  defaultOptions: { queries: { gcTime: 0, retry: false, retryDelay: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const ATTEMPT_ID = 'att_1';

/** What the API answers while the scoring job is still queued. */
const STILL_MARKING = new AppException(ErrorCodes.CONFLICT, 'Not marked yet', { httpStatus: 409 });

const READ_FAILED = new AppException(ErrorCodes.INTERNAL, 'boom', { httpStatus: 500 });

function scoreCardRefuses(error: AppException) {
  return mock.method(api.me, 'scoreCard', () => Promise.reject(error));
}

function mount(panel: ReactNode) {
  render(
    <MemoryRouter initialEntries={[`/performance/${ATTEMPT_ID}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/performance/:attemptId" element={panel} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('a report tab whose marks are not in yet', () => {
  it('says the marks are pending rather than leaving the tab blank', async () => {
    scoreCardRefuses(STILL_MARKING);

    mount(<SubjectPanel />);

    assert.ok(await screen.findByText('No marks yet'));
    assert.equal(screen.queryByText('Your sections did not load'), null);
  });

  /** The failure this prevents: a student handed a Retry for a job that lands a second later. */
  it('asks again by itself, a bounded number of times, before it says so', async () => {
    const scoreCard = scoreCardRefuses(STILL_MARKING);

    mount(<SubjectPanel />);

    await screen.findByText('No marks yet');
    assert.equal(scoreCard.mock.callCount(), 1 + MARKING_TRIES);
  });

  it('says it on the comparison too, which reads the same card', async () => {
    scoreCardRefuses(STILL_MARKING);

    mount(<ComparePanel />);

    assert.ok(await screen.findByText('No marks yet'));
    assert.equal(screen.queryByText('This comparison did not load'), null);
  });
});

const TEST_ID = 'test_1';

const retake = (attemptNo: number, score: number): PerformancePoint => ({
  attemptId: `att_${attemptNo}`,
  attemptNo,
  isGraded: false,
  testId: TEST_ID,
  testTitle: 'Mock 1',
  submittedAt: `2026-09-0${attemptNo}T06:00:00.000Z`,
  score,
  maxMarks: 100,
  percentage: score,
  accuracy: score,
  rank: null,
  percentile: null,
});

/** Oldest first, as the API sends them: the open report is the first, and neither the best nor the newest. */
const SITTINGS = [retake(1, 40), retake(2, 80), retake(3, 60)] as const;

describe('the comparison of a paper nobody is ranked on yet', () => {
  /** The failure this prevents: an older report whose card carries the newest sitting's marks. */
  it('reads "This attempt" from the sitting whose report is open', async () => {
    const unranked = { attemptId: ATTEMPT_ID, testId: TEST_ID, maxMarks: 100, cohort: null };
    mock.method(api.me, 'scoreCard', () => Promise.resolve(unranked as ScoreCard));
    mock.method(api.me, 'performance', () =>
      Promise.resolve({ testsSat: 1, points: [...SITTINGS] }),
    );

    mount(<ComparePanel />);

    const card = (await screen.findByText('This attempt')).closest('li');
    assert.match(card?.textContent ?? '', /40\/100/);
    assert.ok(card?.textContent?.includes(instituteDayLabel(SITTINGS[0].submittedAt) ?? ''));
  });
});

describe('a report tab whose read failed', () => {
  it('says so and asks again when told to, rather than reading as a paper with no sections', async () => {
    const scoreCard = scoreCardRefuses(READ_FAILED);

    mount(<SubjectPanel />);

    assert.ok(await screen.findByText('Your sections did not load'));
    assert.equal(screen.queryByText('No marks yet'), null);

    const asked = scoreCard.mock.callCount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    assert.equal(scoreCard.mock.callCount(), asked + 1);
  });
});
