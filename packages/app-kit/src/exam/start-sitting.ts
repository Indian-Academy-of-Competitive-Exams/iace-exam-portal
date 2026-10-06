/** Getting from the instructions to a paper on screen: the same rule and the same start on web and mobile. */
import { useCallback } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_MODE,
  type ExamBrief,
  type LanguageCode,
  type StartedAttempt,
  type StartAttemptInput,
} from '@iace/contracts';
import { type AppApiClient } from '../api-client';
import { isWorthAskingAgain, retryDelayMs } from '../query-client';
import {
  attemptPaperQueryKey,
  startedAttemptQueryKey,
  testPaperQueryKey,
} from '../student-queries';
import { paperFor } from './served-paper';

/** Three tries at a synchronised open; a refusal is the server's answer, so only a hang or a fault is sent again. */
const START_TRIES = 3;

export const shouldRetryStart = (failures: number, error: unknown): boolean =>
  failures < START_TRIES - 1 && isWorthAskingAgain(error);

/** A start refused because the student's other sign-in is still answering this sitting. */
export const isHeldElsewhere = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.SITTING_HELD_ELSEWHERE;

/** The hold screen's words, the same on both apps: what holds the paper, and what releases it. */
export const HELD_ELSEWHERE_SAYS = {
  title: 'This test is open on your other device',
  hint: 'It can be continued here once that device has been quiet for a minute.',
} as const;

export interface BeginChoice {
  /** A DUAL paper shows every language at once, so there is nothing to choose. */
  dual: boolean;
  chosen: LanguageCode | '';
  ready: boolean;
  /** What the start asks for, once `ready`. */
  languages: readonly LanguageCode[];
}

/** Ready once declared, with a language chosen unless the paper shows them all. */
export function beginChoice(
  paper: Pick<ExamBrief, 'languageMode' | 'languages'>,
  picked: LanguageCode | '',
  declared: boolean,
): BeginChoice {
  const dual = paper.languageMode === LANGUAGE_MODE.DUAL;
  // A paper offering one language has nothing to choose, so it arrives chosen rather than skippable.
  const chosen = picked || (paper.languages.length === 1 ? (paper.languages[0] ?? '') : '');
  const chosenOnly: LanguageCode[] = chosen === '' ? [] : [chosen];
  return {
    dual,
    chosen,
    ready: declared && (dual || chosen !== ''),
    languages: dual ? paper.languages : chosenOnly,
  };
}

/** A cached start is the attempt as it WAS: a handed-in one would draw a paper where nothing saves. */
function forgetSitting(queryClient: QueryClient, testId: string): void {
  const started = queryClient.getQueryData<StartedAttempt>(startedAttemptQueryKey(testId));
  if (started) {
    queryClient.removeQueries({ queryKey: attemptPaperQueryKey(started.id), exact: true });
  }
  queryClient.removeQueries({ queryKey: startedAttemptQueryKey(testId), exact: true });
}

/** Starts the sitting once; its paper is held, else the start's, else fetched; `forget` drops both while mounted. */
export function useStartedSitting(api: AppApiClient, testId: string, start: StartAttemptInput) {
  const queryClient = useQueryClient();
  const attempt = useQuery({
    queryKey: startedAttemptQueryKey(testId),
    queryFn: () =>
      api.me.startAttempt(testId, {
        ...start,
        // Held while they read the instructions: a second copy per student is the bell's most expensive answer.
        holdsPaper:
          queryClient.getQueryData(testPaperQueryKey(testId, start.languages ?? [])) !== undefined,
      }),
    enabled: testId !== '',
    // The sitting is started once; a refetch would be a second start, which the server resumes.
    staleTime: Infinity,
    // Gone with its screen, or a later entry reuses a start with a stale clock; StrictMode re-subscribes first.
    gcTime: 0,
    // One start at a time, and never a second for a refusal: the query dedupes, so only a hang or a fault is retried.
    retry: shouldRetryStart,
    retryDelay: (failures) => retryDelayMs(failures),
  });

  const started = attempt.data ?? null;
  const attemptId = started?.id ?? '';
  const paper = useQuery({
    queryKey: attemptPaperQueryKey(attemptId),
    // Stamped where the payload LANDS, never in a render: that instant is the clock's anchor.
    queryFn: async () => ({
      paper: started
        ? await paperFor(started, queryClient, api.me.attemptPaper)
        : await api.me.attemptPaper(attemptId),
      arrivedAt: Date.now(),
    }),
    enabled: attemptId !== '',
    staleTime: Infinity,
    gcTime: 0,
  });

  const forget = useCallback(() => forgetSitting(queryClient, testId), [queryClient, testId]);

  return { attempt, paper, forget };
}
