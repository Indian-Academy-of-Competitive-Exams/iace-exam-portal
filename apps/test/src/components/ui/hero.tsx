import * as React from 'react';
import { cn } from '@iace/ui';

const TONES = {
  plain: '',
  accent:
    'rounded-2xl border border-border bg-gradient-to-br from-surface to-primary-subtle p-6 shadow-sm sm:p-8',
} as const;

export type HeroTone = keyof typeof TONES;

export interface HeroProps {
  /** The overline above the title — where this sits, in the exam world's own words. */
  eyebrow?: React.ReactNode;
  /** Omitted where the figure IS the headline and a title would only repeat the tab above it. */
  title?: React.ReactNode;
  /** A value under the title. Never a sentence about the screen. */
  meta?: React.ReactNode;
  /** The one number this screen is about, read before the title's words are. */
  figure?: React.ReactNode;
  /** The right-hand block — a window, a chip, the actions. */
  aside?: React.ReactNode;
  /** Top right — what the screen IS, and any notice about it, out of the reading's way. */
  corner?: React.ReactNode;
  tone?: HeroTone;
  className?: string;
}

/** The focal element every primary student screen opens on, before its supporting grid. */
export function Hero({
  eyebrow,
  title,
  meta,
  figure,
  aside,
  corner,
  tone = 'plain',
  className,
}: Readonly<HeroProps>) {
  return (
    <div className={cn('flex flex-col gap-2', TONES[tone], className)}>
      {corner ? <div className="flex items-center justify-end gap-2">{corner}</div> : null}

      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-primary-ink">
              {eyebrow}
            </span>
          ) : null}
          {title ? (
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          ) : null}
          {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
          {figure ? <div className="mt-2">{figure}</div> : null}
        </div>
        {aside ? <div className="flex shrink-0 flex-wrap items-end gap-8">{aside}</div> : null}
      </div>
    </div>
  );
}

export interface HeroFigureProps {
  value: React.ReactNode;
  /** A VALUE qualifying the number — an ordinal suffix, "/ 200", "%". Never a sentence. */
  unit?: React.ReactNode;
  /** What the number IS, written under it so the figure never stands unlabelled. */
  caption?: React.ReactNode;
  className?: string;
}

/** The hero's number at the top of the ramp, where `--text-3xl` is already the KPI step. */
export function HeroFigure({ value, unit, caption, className }: Readonly<HeroFigureProps>) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-primary-ink">
          {value}
        </span>
        {unit ? <span className="text-xl font-semibold text-primary-ink">{unit}</span> : null}
      </span>
      {caption ? <span className="text-sm text-muted-foreground">{caption}</span> : null}
    </div>
  );
}
