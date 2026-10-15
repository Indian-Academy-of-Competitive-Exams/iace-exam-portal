import { createContext, useContext } from 'react';
import type { TourStep } from '../src';

/** What a mounted screen declares about itself. The mounted page IS the registry: no route table to keep in step with the router. */
export interface Registration {
  readonly id: string;
  /** A ref, not an array: a screen writing its steps inline hands a new one every render, and registering on that identity loops. */
  readonly steps: { readonly current: readonly TourStep[] };
}

export interface TourContextValue {
  /** The id alone, because it is all the trigger needs to decide whether to draw — and a steps array a screen built inline would change identity on every render. */
  registeredId: string | null;
  registered: { readonly current: Registration | null };
  register: (registration: Registration | null) => void;
  /** Opens whatever of the registration can actually be pointed at; false when none of it can. */
  start: (registration: Registration) => boolean;
  hasSeen: (id: string) => boolean;
  mark: (id: string) => void;
}

export const TourContext = createContext<TourContextValue | null>(null);

export function useTourContext(): TourContextValue {
  const held = useContext(TourContext);
  if (held === null) throw new Error('usePageTour needs a TourProvider above it');
  return held;
}
