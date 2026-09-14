import { useEffect, useState } from 'react';

/** Seconds left, re-read once a second from `secondsLeftNow`; `onExpire` fires when it reaches zero. */
export function useCountdown(secondsLeftNow: () => number, onExpire: () => void): number {
  const [left, setLeft] = useState(secondsLeftNow);

  useEffect(() => {
    const tick = setInterval(() => setLeft(secondsLeftNow()), 1000);
    return () => clearInterval(tick);
  }, [secondsLeftNow]);

  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);

  return left;
}
