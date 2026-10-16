import { useEffect, useState } from 'react';
import { plural } from '@iace/ui';

const WARN_MINUTES = [1, 5, 10] as const;

/** Speaks only when a threshold is crossed; the ticking clock beside it stays silent. */
export function TimeWarning({ left }: Readonly<{ left: number }>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true));
    return () => clearTimeout(id);
  }, []);
  const minutes = WARN_MINUTES.find((threshold) => left <= threshold * 60);
  // A live region is read on change, not on mount, so it must exist empty first.
  const words = mounted && minutes ? `${plural(minutes, 'minute')} left` : '';
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {words}
    </span>
  );
}
