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

const SHUT = { steps: [] as readonly TourStep[], index: 0 };

/** The position in a run, with no idea what a step points AT — which is what lets mobile share it. */
export function useTourRun(): TourRun {
  // One state, and every move a functional update: that is what makes all four callbacks stable for a caller holding them across renders.
  const [{ steps, index }, setRun] = useState(SHUT);

  const open = useCallback(
    (opening: readonly TourStep[]) => setRun({ steps: opening, index: 0 }),
    [],
  );
  const close = useCallback(() => setRun(SHUT), []);
  const back = useCallback(
    () => setRun((held) => ({ ...held, index: Math.max(0, held.index - 1) })),
    [],
  );
  const next = useCallback(
    () =>
      setRun((held) =>
        held.index + 1 < held.steps.length ? { ...held, index: held.index + 1 } : SHUT,
      ),
    [],
  );

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
