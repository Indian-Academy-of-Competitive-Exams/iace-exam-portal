import { createContext, useContext, type RefObject } from 'react';
import type { TourStep } from '@iace/app-kit';

export interface Registration {
  readonly id: string;
  /** A ref, not an array: a screen writing its steps inline hands a new one every render. */
  readonly steps: { readonly current: readonly TourStep[] };
}

/** A measurable target — every View has this; declared rather than imported so the ref stays a plain View. */
export interface Measurable {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

interface TourContextValue {
  registeredId: string | null;
  registered: RefObject<Registration | null>;
  register: (registration: Registration | null) => void;
  targets: RefObject<Map<string, Measurable>>;
  start: (registration: Registration) => Promise<boolean>;
  hasSeen: (id: string) => boolean;
  mark: (id: string) => void;
}

export const TourContext = createContext<TourContextValue | null>(null);

export function useTourContext(): TourContextValue {
  const held = useContext(TourContext);
  if (held === null) throw new Error('usePageTour needs a TourProvider above it');
  return held;
}
