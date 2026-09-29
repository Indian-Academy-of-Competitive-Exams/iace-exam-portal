import { useCallback, useEffect, useRef } from 'react';

/** Asks before a page with answers unsent closes, and sends them as it goes; `release` lets the page's own navigation through. */
export function useLeaveGuard(hasUnsent: () => boolean, leave: () => void): () => void {
  const released = useRef(false);

  useEffect(() => {
    // The browser writes the prompt itself; all a page may do is ask for it.
    const ask = (event: BeforeUnloadEvent) => {
      if (!released.current && hasUnsent()) event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    // pagehide, not unload: it fires on mobile browsers and when the page goes into the back-forward cache.
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('beforeunload', ask);
      window.removeEventListener('pagehide', leave);
    };
  }, [hasUnsent, leave]);

  return useCallback(() => {
    released.current = true;
  }, []);
}
