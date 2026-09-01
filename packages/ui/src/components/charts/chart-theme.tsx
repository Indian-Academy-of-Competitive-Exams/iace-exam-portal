/**
 * The one place a plot in this folder reads a colour, a type size or a margin.
 * Type is absolute and wears token classes, so a plot cannot change size by
 * being dropped into a wider container.
 */
import type * as React from 'react';
import { Text } from 'recharts';
import { cn } from '../../lib/utils';

/** Assigned in fixed order, never cycled — a ninth series folds into Other instead. */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Recharts takes a colour VALUE, so the token is handed over as the variable itself. */
export const SERIES_VAR = {
  1: 'var(--series-1)',
  2: 'var(--series-2)',
  3: 'var(--series-3)',
  4: 'var(--series-4)',
  5: 'var(--series-5)',
  6: 'var(--series-6)',
  7: 'var(--series-7)',
  8: 'var(--series-8)',
} as const satisfies Record<SeriesSlot, string>;

export const SERIES_SWATCH = {
  1: 'bg-series-1',
  2: 'bg-series-2',
  3: 'bg-series-3',
  4: 'bg-series-4',
  5: 'bg-series-5',
  6: 'bg-series-6',
  7: 'bg-series-7',
  8: 'bg-series-8',
} as const satisfies Record<SeriesSlot, string>;

export const CHART_VAR = {
  surface: 'var(--chart-surface)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  ink: 'var(--chart-ink)',
  muted: 'var(--muted-foreground)',
  success: 'var(--success)',
} as const;

/** Nothing measured. Never 0 — a zero would claim the student scored nothing. */
export const UNMEASURED = '—';

/** The three sizes a plot writes in, off the token scale: 13, 12 and 11. */
export const PLOT_TEXT = {
  value: 'fill-foreground text-sm font-semibold',
  axis: 'fill-chart-ink text-xs',
  meta: 'fill-muted-foreground text-2xs',
} as const;

export type PlotTone = keyof typeof PLOT_TEXT;
export type PlotAnchor = 'start' | 'middle' | 'end';

/** Pinned rather than auto, so two plots stacked on one x start at the same edge. */
export const PLOT_AXIS_WIDTH = 36;

export const PLOT_MARGIN = { top: 20, right: 12, bottom: 4, left: 0 } as const;

/** Hoisted, not inline: a fresh object on every render sends Recharts round again. */
export const AXIS_LINE = { stroke: CHART_VAR.axis } as const;
export const CURSOR_LINE = { stroke: CHART_VAR.axis, strokeDasharray: '4 4' } as const;
export const CURSOR_BAND = { fill: CHART_VAR.muted, fillOpacity: 0.08 } as const;
export const TIP_WRAPPER = { outline: 'none' } as const;

export const BAR_RADIUS = 4;
export const BAR_MAX = 24;
export const LINE_WIDTH = 2;
export const DOT_RADIUS = 4;
export const DOT_RING = 2;

export type PlotTextProps = React.SVGProps<SVGTextElement> & { tone: PlotTone };

export function PlotText({ tone, className, ...props }: Readonly<PlotTextProps>) {
  return <text {...props} className={cn(PLOT_TEXT[tone], className)} />;
}

export interface PlotTickTextProps {
  x: number;
  y: number;
  /** The room this label has; Recharts measures the string and adds its own ellipsis. */
  width?: number;
  tone?: PlotTone;
  anchor?: PlotAnchor;
  vertical?: PlotAnchor;
  children: string;
}

/** Recharts' own Text measures, so a label wider than its slot is cut rather than smeared. */
export function PlotTickText({
  x,
  y,
  width,
  tone = 'axis',
  anchor = 'middle',
  vertical = 'start',
  children,
}: Readonly<PlotTickTextProps>) {
  return (
    <Text
      x={x}
      y={y}
      width={width}
      maxLines={1}
      textAnchor={anchor}
      verticalAnchor={vertical}
      className={PLOT_TEXT[tone]}
    >
      {children}
    </Text>
  );
}

/** Centred on a point sitting ON the edge, half a label falls off the box. */
export function anchorAt(index: number, count: number): PlotAnchor {
  if (index === 0) return 'start';
  return index === count - 1 ? 'end' : 'middle';
}
