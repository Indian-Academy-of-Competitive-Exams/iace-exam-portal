/**
 * The countdown both clients draw a paper's and a section's clock with. Expiry
 * fires once per arrival at zero and re-arms when the count rises again, for the
 * next section. The callback's identity is never a trigger: the engine rebuilds
 * it every render, and re-firing on each one would resubmit a failed paper in a storm.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Seconds left, re-read once a second from `secondsLeftNow`. */
export function useCountdown(secondsLeftNow: () => number, onExpire: () => void): number {
  const [left, setLeft] = useState(secondsLeftNow);
  const latestOnExpire = useRef(onExpire);
  const expired = useRef(false);

  useEffect(() => {
    latestOnExpire.current = onExpire;
  });

  useEffect(() => {
    const tick = setInterval(() => setLeft(secondsLeftNow()), 1000);
    return () => clearInterval(tick);
  }, [secondsLeftNow]);

  useEffect(() => {
    if (left > 0) {
      expired.current = false;
      return;
    }
    if (expired.current) return;
    expired.current = true;
    latestOnExpire.current();
  }, [left]);

  return left;
}

/** A count a fresher `allowedSec` re-anchors to now, so its own elapsed time is never subtracted twice. */
export function useAnchoredCountdown(allowedSec: number, onExpire: () => void): number {
  // `at: 0` until the effect below fires, which is before any real tick can read it.
  const anchor = useRef({ at: 0, allowedSec });

  useEffect(() => {
    anchor.current = { at: Date.now(), allowedSec };
  }, [allowedSec]);

  return useCountdown(
    useCallback(() => {
      const { at, allowedSec: value } = anchor.current;
      return at === 0 ? value : Math.max(0, value - Math.round((Date.now() - at) / 1000));
    }, []),
    onExpire,
  );
}
