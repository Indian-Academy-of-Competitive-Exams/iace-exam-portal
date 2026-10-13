import { useState } from 'react';
import { PAUSE_SAYS } from './exam-view';

/** Asking before a pause, and staying on the paper when its answers could not be saved first. */
export function usePause(onPause: (() => Promise<boolean>) | undefined) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return {
    asking,
    pending,
    says: failed ? PAUSE_SAYS.failed : PAUSE_SAYS.hint,
    ask: () => {
      setFailed(false);
      setAsking(true);
    },
    cancel: () => setAsking(false),
    confirm: () => {
      if (!onPause || pending) return;
      setPending(true);
      // A pause that went through unmounts this screen, so only the refusal is left to draw.
      void onPause().then((paused) => {
        if (paused) return;
        setPending(false);
        setFailed(true);
      });
    },
  };
}
