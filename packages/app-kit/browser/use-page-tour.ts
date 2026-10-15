import { useEffect, useRef } from 'react';
import type { TourStep } from '../src';
import { useTourContext } from './tour-context';

/** One call per screen: it puts the header's help icon on, and opens the tour once on a first visit. */
export function usePageTour({
  id,
  steps,
  ready,
}: Readonly<{ id: string; steps: readonly TourStep[]; ready: boolean }>): void {
  const { register, start, hasSeen, mark } = useTourContext();
  const attempted = useRef(false);
  const latest = useRef(steps);

  // Synced in an effect, never during render: the React Compiler rules refuse a ref written while rendering.
  useEffect(() => {
    latest.current = steps;
  }, [steps]);

  // Keyed on the ID alone. A screen that builds its steps inline would otherwise re-register on every render.
  useEffect(() => {
    register({ id, steps: latest });
    return () => register(null);
  }, [register, id]);

  useEffect(() => {
    if (attempted.current || !ready || hasSeen(id)) return;
    attempted.current = true;
    // Marked only when it OPENED: a screen whose targets had not painted yet gets another chance on the next visit.
    if (start({ id, steps: latest })) mark(id);
  }, [ready, id, start, hasSeen, mark]);
}
