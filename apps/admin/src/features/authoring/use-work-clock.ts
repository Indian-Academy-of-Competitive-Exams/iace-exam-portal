import { useCallback, useEffect, useState } from 'react';
import { WORK_TIME_REPORT_MAX_SECONDS } from '@iace/contracts';
import { api } from '../../lib/api';
import { NEW_CARD } from './authoring-workspace';
import { WorkClock, reportTime } from './work-clock';

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

  const report = useCallback(
    (keepalive = false) => {
      // The blank card is held back: there is no question to count it against until its save names one.
      reportTime(clock, WORK_TIME_REPORT_MAX_SECONDS, NEW_CARD, (key, seconds) =>
        api.admin.sectionWork.spend(testId, sectionId, key, { seconds }, { keepalive }),
      );
    },
    [clock, testId, sectionId],
  );

  useEffect(() => {
    const reporting = setInterval(() => report(), REPORT_EVERY_MS);
    const onHide = () => {
      // On keepalive: a tab hidden because it is closing cancels an ordinary request.
      if (document.visibilityState === 'hidden') report(true);
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
