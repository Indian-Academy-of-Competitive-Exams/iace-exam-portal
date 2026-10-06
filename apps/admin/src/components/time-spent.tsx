import { Timer } from 'lucide-react';
import { clockText } from '@iace/contracts';

/** A length of time on screen: behind a clock glyph, or behind the seat whose time it is. */
export function TimeSpent({
  seconds,
  seat,
  label = 'Time spent',
}: Readonly<{ seconds: number; seat?: string; label?: string }>) {
  return (
    <span className="flex flex-none items-center gap-1 text-xs tabular-nums text-muted-foreground [&_svg]:size-3.5">
      {seat ?? (
        <>
          <Timer aria-hidden />
          <span className="sr-only">{label}</span>
        </>
      )}
      {clockText(seconds)}
    </span>
  );
}
