import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import type { TourStep } from '@iace/app-kit';
import { useTourContext, type Measurable } from './tour-context';

/** Registers a view as a tour target; an undefined key attaches nothing, so a list can anchor its first row alone. */
export function useTourTarget(key?: string): { ref?: (view: Measurable | null) => void } {
  const { targets } = useTourContext();

  const ref = useCallback(
    (view: Measurable | null) => {
      if (key === undefined) return;
      if (view === null) {
        targets.current.delete(key);
        return;
      }
      targets.current.set(key, view);
    },
    [targets, key],
  );

  return { ref };
}

/** One call per screen: it puts the header's help icon on, and opens the tour once on a first visit. */
export function usePageTour({
  id,
  steps,
  ready,
}: Readonly<{ id: string; steps: readonly TourStep[]; ready: boolean }>): void {
  const { registeredId, register, start, hasSeen, mark } = useTourContext();
  const attempted = useRef(false);
  // Tabs stay mounted: a screen behind another would spend its tour unseen and close the one showing.
  const isInFront = registeredId === id;
  const latest = useRef(steps);

  // Synced in an effect, never during render, and read through the ref so an inline steps array cannot re-register.
  useEffect(() => {
    latest.current = steps;
  }, [steps]);

  // On FOCUS, not on mount: nothing unmounts on blur here, so a mount-time claim is never handed back.
  useFocusEffect(
    useCallback(() => {
      register({ id, steps: latest });
      return () => register(null);
    }, [register, id]),
  );

  useEffect(() => {
    if (attempted.current || !ready || !isInFront || hasSeen(id)) return;
    attempted.current = true;
    // Marked only when it OPENED: a screen whose targets had not mounted yet gets another chance.
    void start({ id, steps: latest }).then((opened) => {
      if (opened) mark(id);
    });
  }, [ready, isInFront, id, start, hasSeen, mark]);
}
