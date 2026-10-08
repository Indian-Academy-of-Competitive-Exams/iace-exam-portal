import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_CODE,
  type StartAttemptInput,
  type StartedAttempt,
} from '@iace/contracts';
import './support/offline';
import { api } from '../src/lib/api';
import { RESUME_PARAM, ROUTES } from '../src/lib/constants';
import { useAddressedSitting } from '../src/features/exam/use-sitting-address';

const TEST_ID = 'test_1';
const ATTEMPT_ID = 'att_1';
const EXAM = ROUTES.EXAM(TEST_ID);
const NAMED = `${EXAM}?${RESUME_PARAM}=${ATTEMPT_ID}`;
const BEGAN = { languages: [LANGUAGE_CODE.EN] };

const STARTED = {
  id: ATTEMPT_ID,
  testId: TEST_ID,
  languages: BEGAN.languages,
  paper: null,
} as unknown as StartedAttempt;

afterEach(() => {
  cleanup();
  mock.restoreAll();
});

/** The exam page's own wiring, without the skins: what it starts with, and where the address ends up. */
function Hall() {
  const location = useLocation();
  const navigate = useNavigate();
  const began = (location.state ?? {}) as Partial<typeof BEGAN>;
  const { attempt, resume } = useAddressedSitting(TEST_ID, {
    languages: began.languages,
    tab: 'tab_1',
  });
  const ended = AppException.is(attempt.error) && attempt.error.code === ErrorCodes.SITTING_ENDED;

  return (
    <>
      <output aria-label="address">{`${location.pathname}${location.search}`}</output>
      <output aria-label="languages">{began.languages?.join() ?? 'none'}</output>
      {ended ? <output aria-label="ended">{resume}</output> : null}
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}

/** A fresh client per mount, as a reload gets: nothing of the last page's start survives it. */
function open(entries: Parameters<typeof MemoryRouter>[0]['initialEntries']) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  render(
    <MemoryRouter initialEntries={entries} initialIndex={(entries?.length ?? 1) - 1}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path={ROUTES.EXAM_PATTERN} element={<Hall />} />
          <Route path={ROUTES.TEST_INSTRUCTIONS_PATTERN} element={<p>Instructions</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function startAnswers() {
  mock.method(api.me, 'attemptPaper', () => new Promise(() => undefined));
  return mock.method(api.me, 'startAttempt', () => Promise.resolve(STARTED));
}

const askedWith = (start: ReturnType<typeof startAnswers>, call: number) =>
  start.mock.calls[call]?.arguments[1] as StartAttemptInput;

describe('the exam address', () => {
  it('names the sitting once the start answers, and starts nothing again to do it', async () => {
    const start = startAnswers();

    open([{ pathname: EXAM, state: BEGAN }]);

    assert.ok(await screen.findByText(NAMED));
    assert.equal(start.mock.callCount(), 1);
    assert.equal(askedWith(start, 0).resume, undefined, 'beginning names no sitting');
    assert.equal(screen.getByLabelText('languages').textContent, LANGUAGE_CODE.EN);
  });

  /** The failure this prevents: a reload after the paper was handed in starting a retake nobody asked for. */
  it('is a reclaim when reloaded, so an ended sitting is refused rather than replaced', async () => {
    startAnswers();
    open([EXAM]);
    const address = (await screen.findByText(NAMED)).textContent;
    cleanup();
    mock.restoreAll();

    const reload = mock.method(api.me, 'startAttempt', () =>
      Promise.reject(new AppException(ErrorCodes.SITTING_ENDED)),
    );
    open([address]);

    assert.equal((await screen.findByLabelText('ended')).textContent, ATTEMPT_ID);
    assert.equal(reload.mock.callCount(), 1);
    assert.equal(askedWith(reload, 0).resume, ATTEMPT_ID);
  });

  /** The failure this prevents: the nameless address left one Back away, where it is a plain start. */
  it('replaces the entry it was opened on', async () => {
    startAnswers();
    open([ROUTES.TEST_INSTRUCTIONS(TEST_ID), EXAM]);
    await screen.findByText(NAMED);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    assert.ok(await screen.findByText('Instructions'));
  });
});
