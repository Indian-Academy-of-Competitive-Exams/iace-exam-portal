const WARN_MINUTES = [1, 5, 10] as const;

/** Speaks only when a threshold is crossed; the ticking clock beside it stays silent. */
export function TimeWarning({ left }: Readonly<{ left: number }>) {
  const minutes = WARN_MINUTES.find((threshold) => left <= threshold * 60);
  const words = minutes ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left` : '';
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {words}
    </span>
  );
}
