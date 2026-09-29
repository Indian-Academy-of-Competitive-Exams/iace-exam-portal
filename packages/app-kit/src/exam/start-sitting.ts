/** Getting from the instructions to a paper on screen: the same rule and the same start on web and mobile. */
import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  LANGUAGE_MODE,
  type ExamBrief,
  type LanguageCode,
  type StartedAttempt,
  type StartAttemptInput,
} from '@iace/contracts';
import { type AppApiClient } from '../api-client';
import { attemptPaperQueryKey, startedAttemptQueryKey } from '../student-queries';
import { paperFor } from './served-paper';

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

/** Starts the sitting once; its paper is the one held while they read, else the start's, else a fetch. */
export function useStartedSitting(api: AppApiClient, testId: string, start: StartAttemptInput) {
  const queryClient = useQueryClient();
  const attempt = useQuery({
    queryKey: startedAttemptQueryKey(testId),
    queryFn: () => api.me.startAttempt(testId, start),
    enabled: testId !== '',
    // The sitting is started once; a refetch would be a second start, which the server resumes.
    staleTime: Infinity,
    retry: false,
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
  });

  const forget = useCallback(() => forgetSitting(queryClient, testId), [queryClient, testId]);
  // On unmount, never on ending: a still-mounted query rebuilds what was removed, and that fetch IS a second start.
  useEffect(() => forget, [forget]);

  return { attempt, paper, forget };
}
