import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExamPaper, ExamQuestion, SectionProgress } from '@iace/contracts';
import { useExamView, type AppApiClient, type ExamEngineDeps, type FullscreenHandle } from '../src';
import { fakeStorage } from './support/fake-storage';

const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

const questionFor = (sectionId: string, order: number): ExamQuestion => ({
  questionId: `${sectionId}-q1`,
  order,
  baseConfigSectionId: sectionId,
  type: 'SINGLE_MCQ',
  marks: 1,
  negativeMarks: 0,
  content: {},
  options: [],
});

const paper = (): ExamPaper => ({
  attemptId: 'attempt-1',
  endsAt: '2026-09-01T07:00:00.000Z',
  serverNow: '2026-09-01T05:00:00.000Z',
  languages: ['EN'],
  languageMode: 'SINGLE',
  examTemplate: 'DEFAULT',
  testUi: 'CBT',
  timerTemplate: 'SECTIONAL_LOCKED',
  navigation: 'FREE',
  calculatorEnabled: false,
  sections: [
    { id: 'sec1', name: 'Section 1', order: 1, questionCount: 1, durationSec: 1800 },
    { id: 'sec2', name: 'Section 2', order: 2, questionCount: 1, durationSec: 1800 },
    { id: 'sec3', name: 'Section 3', order: 3, questionCount: 1, durationSec: 1800 },
  ],
  questions: [questionFor('sec1', 1), questionFor('sec2', 2), questionFor('sec3', 3)],
});

const focus: FullscreenHandle = {
  isFullscreen: false,
  isSupported: false,
  exits: 0,
  enter: async () => {},
  exit: async () => {},
};

function depsFor(api: AppApiClient): ExamEngineDeps {
  return {
    api,
    tab: 'tab-1',
    answerQueue: { storage: fakeStorage(), keyPrefix: 'test.queued' },
    focus,
    catalogQueryKey: ['catalog'],
  };
}

type SaveCall = { revision: number; sections?: Record<string, SectionProgress> };

function apiWith(
  sections: Record<string, SectionProgress>,
  onSave: (body: SaveCall) => void = () => {},
): AppApiClient {
  return {
    me: {
      attemptState: async () => ({ answers: {}, sections, revision: 0 }),
      saveAttemptState: async (_id: string, body: SaveCall) => {
        onSave(body);
        return {
          revision: body.revision,
          applied: true,
          endsAt: paper().endsAt,
          serverNow: paper().serverNow,
        };
      },
      submitAttempt: async () => {
        throw new Error('not used in this test');
      },
    },
  } as unknown as AppApiClient;
}

function mounted(api: AppApiClient) {
  const deps = depsFor(api);
  return renderHook(
    () =>
      useExamView(
        { paper: paper(), arrivedAt: Date.now(), title: null, watermark: '', onEnded: () => {} },
        deps,
      ),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

/** The failure this prevents: a reloaded sitting mounting into section one though it closed long ago. */
test("a reload lands in the first section still open, not the paper's first", async (t) => {
  const api = apiWith({
    sec1: { remainingSec: 0, closed: true },
    sec2: { remainingSec: 0, closed: true },
    sec3: { remainingSec: 1200, closed: false, openedAt: '2026-09-01T04:50:00.000Z' },
  });
  const { result, unmount } = mounted(api);
  t.after(unmount);

  // The server's own section state has to arrive before the screen can trust it.
  await act(async () => {
    await Promise.resolve();
  });

  assert.deepEqual(result.current.reachable, ['sec3']);
  assert.equal(
    result.current.sectionId,
    'sec3',
    'the screen must not stay on the closed first section',
  );
});

/** The failure this prevents: section one's clock never being stamped, so a reload gives it back in full. */
test('a fresh sitting stamps its first section on the next save, not only on leaving it', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const sent: SaveCall[] = [];
  const api = apiWith({}, (body) => sent.push(body));
  const { result, unmount } = mounted(api);
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(result.current.sectionId, 'sec1');

  // The periodic autosave is the only thing that ever carries a section to the server.
  await act(async () => {
    mock.timers.tick(31_000);
    await Promise.resolve();
    await Promise.resolve();
  });

  const stamped = sent.find((body) => body.sections?.sec1 !== undefined);
  assert.ok(
    stamped,
    'section one was carried in a save, not left to be stamped only when it is left',
  );
  assert.equal(stamped?.sections?.sec1?.closed, false);
});
