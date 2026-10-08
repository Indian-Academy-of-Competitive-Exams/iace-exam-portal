import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { type StartAttemptInput } from '@iace/contracts';
import { useStartedSitting } from '@iace/app-kit';
import { api } from '../../lib/api';
import { RESUME_PARAM } from '../../lib/constants';

/** The query a Resume carries to the hall: it names its sitting, so one handed in since is never begun afresh. */
export const resumeSearch = (attemptId: string | null | undefined): string =>
  attemptId ? `?${RESUME_PARAM}=${attemptId}` : '';

/** The exam page's start: its address names the sitting, so a reload reclaims that one and never starts another. */
export function useAddressedSitting(testId: string, start: Omit<StartAttemptInput, 'resume'>) {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const resume = params.get(RESUME_PARAM) ?? undefined;
  const sitting = useStartedSitting(api, testId, { ...start, resume });
  const attemptId = sitting.attempt.data?.id;

  useEffect(() => {
    if (attemptId === undefined || attemptId === resume) return;
    // Replaced, not pushed: the nameless address must not wait one Back away, where it is a plain start.
    setParams(
      (held) => {
        held.set(RESUME_PARAM, attemptId);
        return held;
      },
      { replace: true, state },
    );
  }, [attemptId, resume, setParams, state]);

  return { ...sitting, resume };
}
