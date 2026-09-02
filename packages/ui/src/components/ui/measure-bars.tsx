import { cn } from '../../lib/utils';
import { TruncatedText } from './truncated-text';

/** Which hue a bar wears. Identity only — a magnitude comparison leaves them all on one. */
const TONES = {
  1: 'bg-[var(--series-1)]',
  2: 'bg-[var(--series-2)]',
  3: 'bg-[var(--series-3)]',
} as const;

export type MeasureTone = keyof typeof TONES;

export interface MeasureBar {
  key: string;
  label: string;
  value: number;
  /** What the row says on its right. Defaults to the value — pass a formatted one instead. */
  display?: string;
  /** The n behind the value, written beside it so the fill is never read without its sample. */
  meta?: string;
  /** Too few behind it to stand beside the rest: drawn as a wash rather than a reading. */
  faint?: boolean;
  tone?: MeasureTone;
}

export interface MeasureBarsProps {
  bars: readonly MeasureBar[];
  /** The top of the scale. Every bar is read against this one number, never against each other. */
  max: number;
  className?: string;
}

/** Labelled magnitude bars: every value is written out, so the fill never has to carry it alone. */
export function MeasureBars({ bars, max, className }: Readonly<MeasureBarsProps>) {
  const ceiling = Math.max(max, ...bars.map((bar) => bar.value), 1);
  const measured = bars.some((bar) => bar.meta !== undefined);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {bars.map((bar) => (
        <div
          key={bar.key}
          className={cn(
            'grid items-center gap-3 text-sm',
            measured ? 'grid-cols-[11rem_1fr_4rem_4.5rem]' : 'grid-cols-[11rem_1fr_4rem]',
          )}
        >
          <TruncatedText className="text-muted-foreground">{bar.label}</TruncatedText>
          <span className="h-2 rounded-full bg-muted">
            <span
              className={cn(
                'block h-2 rounded-full',
                TONES[bar.tone ?? 1],
                bar.faint && 'opacity-40',
              )}
              style={{ width: `${Math.max(0, Math.min(bar.value / ceiling, 1)) * 100}%` }}
            />
          </span>
          <span
            className={cn(
              'text-right font-medium tabular-nums',
              bar.faint ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {bar.display ?? bar.value}
          </span>
          {measured ? (
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {bar.meta}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
