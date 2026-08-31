import * as React from 'react';
import { cn } from '../../lib/utils';
import { ChartLegend } from './chart-legend';
import { ChartTooltip, type ChartTip } from './chart-tooltip';

/** What a slice of the whole IS, not which series it happens to be. */
export type CompositionTone = 'positive' | 'negative' | 'neutral';

export interface CompositionSegment {
  key: string;
  label: string;
  value: number;
  /** What the segment says when there is room, and what its hover always says. */
  display?: string;
  tone?: CompositionTone;
}

export interface CompositionBarProps {
  segments: readonly CompositionSegment[];
  size?: 'sm' | 'md';
  legend?: boolean;
  'aria-label': string;
  className?: string;
}

const FILL = {
  positive: 'bg-success text-success-foreground',
  negative: 'bg-destructive text-destructive-foreground',
  neutral: 'bg-muted-foreground text-background',
} as const satisfies Record<CompositionTone, string>;

const SWATCH = {
  positive: 'bg-success',
  negative: 'bg-destructive',
  neutral: 'bg-muted-foreground',
} as const satisfies Record<CompositionTone, string>;

/** Below this share the words would be clipped, so the value goes to the hover instead. */
const LABEL_FLOOR = 0.11;

export function CompositionBar({
  segments,
  size = 'md',
  legend,
  className,
  ...props
}: Readonly<CompositionBarProps>) {
  const [tip, setTip] = React.useState<ChartTip | null>(null);
  const total = segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0);
  const drawn = segments.filter((segment) => segment.value > 0);
  const showLegend = legend ?? size === 'md';

  const placed = drawn.map((segment, index) => {
    const before = drawn.slice(0, index).reduce((sum, earlier) => sum + earlier.value, 0);
    const share = total === 0 ? 0 : segment.value / total;
    return { segment, share, centre: (total === 0 ? 0 : before / total) + share / 2 };
  });

  const show = (at: (typeof placed)[number]) => () =>
    setTip({
      x: at.centre,
      y: 0,
      title: at.segment.label,
      rows: [
        {
          key: at.segment.key,
          value: textFor(at.segment),
          swatch: SWATCH[at.segment.tone ?? 'neutral'],
        },
      ],
    });

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="relative">
        <div
          role="img"
          aria-label={props['aria-label']}
          className={cn(
            'flex w-full gap-[2px] overflow-hidden',
            size === 'md' ? 'h-9 rounded-md' : 'h-2.5 rounded-full',
          )}
        >
          {placed.map((at) => (
            <div
              key={at.segment.key}
              style={{ flexGrow: at.segment.value }}
              role="img"
              aria-label={`${at.segment.label}: ${textFor(at.segment)}`}
              onPointerEnter={show(at)}
              onPointerLeave={() => setTip(null)}
              className={cn(
                'flex min-w-0 items-center justify-center text-xs font-semibold tabular-nums',
                FILL[at.segment.tone ?? 'neutral'],
              )}
            >
              {size === 'md' && at.share >= LABEL_FLOOR ? textFor(at.segment) : null}
            </div>
          ))}
        </div>
        <ChartTooltip tip={tip} />
      </div>

      {showLegend ? (
        <ChartLegend
          items={segments.map((segment) => ({
            key: segment.key,
            label: segment.label,
            value: textFor(segment),
            swatch: SWATCH[segment.tone ?? 'neutral'],
          }))}
        />
      ) : null}
    </div>
  );
}

function textFor(segment: CompositionSegment): string {
  return segment.display ?? String(segment.value);
}
