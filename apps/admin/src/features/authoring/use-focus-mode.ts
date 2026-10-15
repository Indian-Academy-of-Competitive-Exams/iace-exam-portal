import { useEffect, useState } from 'react';
import { useFullscreen, useWorkspace } from '@iace/app-kit/browser';

/** Escape and F11 raise the exit count, so leaving full screen is derived, not listened for. */
export function useFocusMode() {
  const fullscreen = useFullscreen();
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const immersive = focusedAt !== null && fullscreen.exits === focusedAt;
  useWorkspace(immersive);

  // One way out for the toggle and for a page that goes away while immersive: the browser leaves with the chrome.
  const { exit } = fullscreen;
  useEffect(() => (immersive ? () => void exit() : undefined), [immersive, exit]);

  const toggle = () => {
    if (immersive) return setFocusedAt(null);
    setFocusedAt(fullscreen.exits);
    void fullscreen.enter();
  };

  return { immersive, toggle };
}
