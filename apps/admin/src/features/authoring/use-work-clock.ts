import { useCallback, useEffect, useState } from 'react';
import { AppException, WORK_TIME_REPORT_MAX_SECONDS } from '@iace/contracts';
import { api } from '../../lib/api';
import { NEW_CARD } from './authoring-workspace';
import { WorkClock } from './work-clock';

const SECOND_MS = 1000;

/** How often what has been counted is handed to the server. */
const REPORT_EVERY_MS = 30_000;

/** The clock for the question in view: it runs while the tab is visible, and reports as it goes and as it leaves. */
export function useWorkClock(testId: string, sectionId: string, watched: string | null): WorkClock {
  const [clock] = useState(() => new WorkClock());

  useEffect(() => {
    clock.watch(watched);
  }, [clock, watched]);

  useEffect(() => {
    const ticking = setInterval(() => {
      if (document.visibilityState === 'visible') clock.tick();
    }, SECOND_MS);
    return () => clearInterval(ticking);
  }, [clock]);

  const report = useCallback(() => {
    // The blank card is held back: there is no question to count it against until its save names one.
    for (const [key, seconds] of clock.take(WORK_TIME_REPORT_MAX_SECONDS, NEW_CARD)) {
      api.admin.sectionWork.spend(testId, sectionId, key, { seconds }).catch((error: unknown) => {
        // A refusal is final — the question is gone, or the seat is — so only a request that never landed is kept.
        if (!AppException.is(error)) clock.giveBack(key, seconds);
      });
    }
  }, [clock, testId, sectionId]);

  useEffect(() => {
    const reporting = setInterval(report, REPORT_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') report();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(reporting);
      document.removeEventListener('visibilitychange', onHide);
      report();
    };
  }, [report]);

  return clock;
}
