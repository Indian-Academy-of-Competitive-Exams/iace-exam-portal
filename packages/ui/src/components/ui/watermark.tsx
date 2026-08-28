/**
 * A repeating mark across whatever it covers. Faint enough to read through and
 * impossible to select or click, so it survives a screenshot without costing a
 * reader anything. What it says is the caller's — this holds no identity of its own.
 */
import { cn } from '../../lib/utils';

/** Enough repeats to reach the corners of a tall screen without counting pixels. */
const TILES = Array.from({ length: 36 }, (_, index) => index);

export interface WatermarkProps {
  text: string;
  className?: string;
}

export function Watermark({ text, className }: Readonly<WatermarkProps>) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 select-none overflow-hidden',
        'grid grid-cols-3 place-items-center gap-x-8 gap-y-16',
        className,
      )}
    >
      {TILES.map((tile) => (
        <span key={tile} className="watermark-tile">
          {text}
        </span>
      ))}
    </div>
  );
}
