/**
 * The Fullscreen API, and how often it has been LEFT. Entering needs a user
 * gesture, so `enter` is called from a click and never from an effect — a
 * screen that finds itself out of fullscreen can only ask, not take.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** Safari still answers to the prefixed names, and students sit exams on iPads. */
interface PrefixedDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}
interface PrefixedElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

const elementOf = (): Element | null => {
  const doc = document as PrefixedDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};

export interface FullscreenHandle {
  isFullscreen: boolean;
  /** False where the browser has no Fullscreen API at all — then nothing here is asked for. */
  isSupported: boolean;
  /** How many times it has been left since this page loaded. */
  exits: number;
  enter: () => Promise<void>;
}

/** Subscribed rather than mirrored into state: the DOM owns this, and it is right on the first render. */
function subscribe(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
  };
}

export function useFullscreen(): FullscreenHandle {
  const isFullscreen = useSyncExternalStore(
    subscribe,
    () => elementOf() !== null,
    () => false,
  );
  const [exits, setExits] = useState(0);

  const isSupported =
    typeof document !== 'undefined' &&
    (document.documentElement.requestFullscreen !== undefined ||
      (document.documentElement as PrefixedElement).webkitRequestFullscreen !== undefined);

  useEffect(
    () =>
      // Counted only on the way OUT, so entering never reads as leaving.
      subscribe(() => {
        if (elementOf() === null) setExits((left) => left + 1);
      }),
    [],
  );

  const enter = useCallback(async () => {
    const root = document.documentElement as PrefixedElement;
    const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
    // A refusal is not an error worth throwing: the screen offers it again rather than breaking.
    await request?.().catch(() => undefined);
  }, []);

  return { isFullscreen, isSupported, exits, enter };
}
