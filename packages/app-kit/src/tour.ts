import { useCallback, useState } from 'react';
import { type KeyValueStorage } from './token-store';

/** One stop on a tour. `target` matches a `data-tour` attribute on web, a `useTourTarget` key on mobile. */
export interface TourStep {
  readonly target: string;
  readonly title: string;
  readonly body: string;
}

export interface SeenTours {
  has: (id: string) => boolean;
  mark: (id: string) => void;
}

/** A half-written or foreign value reads as nothing seen; the next mark overwrites it. */
function storedIds(storage: KeyValueStorage, key: string): string[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const held: unknown = JSON.parse(raw);
    return Array.isArray(held) ? held.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Which tours this device has been shown: ONE key holding the set, so a tour added later needs no migration. */
export function seenTours(storage: KeyValueStorage, key: string): SeenTours {
  return {
    has: (id) => storedIds(storage, key).includes(id),
    mark: (id) => {
      const held = storedIds(storage, key);
      if (held.includes(id)) return;
      storage.setItem(key, JSON.stringify([...held, id]));
    },
  };
}

export interface TourRun {
  readonly step: TourStep | null;
  readonly index: number;
  readonly count: number;
  readonly isLast: boolean;
  open: (steps: readonly TourStep[]) => void;
  next: () => void;
  back: () => void;
  close: () => void;
}

/** The position in a run, with no idea what a step points AT — which is what lets mobile share it. */
export function useTourRun(): TourRun {
  const [steps, setSteps] = useState<readonly TourStep[]>([]);
  const [index, setIndex] = useState(0);

  const close = useCallback(() => {
    setSteps([]);
    setIndex(0);
  }, []);

  const open = useCallback((opening: readonly TourStep[]) => {
    setSteps(opening);
    setIndex(0);
  }, []);

  const next = useCallback(() => {
    if (index + 1 < steps.length) {
      setIndex(index + 1);
      return;
    }
    close();
  }, [index, steps.length, close]);

  const back = useCallback(() => setIndex((at) => Math.max(0, at - 1)), []);

  return {
    step: steps[index] ?? null,
    index,
    count: steps.length,
    isLast: steps.length > 0 && index === steps.length - 1,
    open,
    next,
    back,
    close,
  };
}
