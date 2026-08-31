import * as React from 'react';
import { cn } from '../../lib/utils';
import {
  PLOT_PAD,
  PLOT_PAD_COMPACT,
  PLOT_WIDTH,
  SERIES_FILL,
  SERIES_STROKE,
  SERIES_SWATCH,
  bandX,
  pointX,
  scaleY,
  type PlotPad,
  type PlotScale,
  type SeriesSlot,
} from './chart-geometry';
import { ChartTooltip, type ChartTip } from './chart-tooltip';

export interface LinePoint {
  key: string;
  label: string;
  /** Null is nothing to plot, which is not zero — it draws no marker and breaks the line. */
  value: number | null;
  display?: string;
  caption?: string;
}

/** A shaded y-range the line is read against, such as where the middle of the cohort sits. */
export interface PlotBand {
  from: number;
  to: number;
  label: string;
}

export interface PlotReference {
  value: number;
  label: string;
  tone?: 'good' | 'neutral';
}

export interface LinePlotProps {
  points: readonly LinePoint[];
  min?: number;
  max?: number;
  suffix?: string;
  series?: SeriesSlot;
  ticks?: readonly number[];
  band?: PlotBand;
  reference?: PlotReference;
  /** A sparkline: the line alone, sized to sit beside a number. */
  compact?: boolean;
  /** `bands` puts each point over the middle of a column band, so it stacks on a ColumnPlot. */
  align?: 'edges' | 'bands';
  xLabels?: boolean;
  height?: number;
  /** A wider viewBox for a wider card keeps the type the same size on screen. */
  width?: number;
  'aria-label': string;
  className?: string;
}

interface PlottedPoint extends LinePoint {
  index: number;
  x: number;
  y: number | null;
}

const DEFAULT_HEIGHT = 420;
const COMPACT_HEIGHT = 340;
const MAX_X_LABELS = 6;

export function LinePlot({
  points,
  min = 0,
  max = 100,
  suffix = '',
  series = 1,
  ticks,
  band,
  reference,
  compact = false,
  align = 'edges',
  xLabels = true,
  height,
  width = PLOT_WIDTH,
  className,
  ...props
}: Readonly<LinePlotProps>) {
  const [tip, setTip] = React.useState<ChartTip | null>(null);
  const pad = compact ? PLOT_PAD_COMPACT : PLOT_PAD;
  const box = height ?? (compact ? COMPACT_HEIGHT : DEFAULT_HEIGHT);
  const scale: PlotScale = { min, max };
  const floor = box - pad.bottom;
  const at = align === 'bands' ? bandX : pointX;

  const plotted: PlottedPoint[] = points.map((point, index) => ({
    ...point,
    index,
    x: at(index, points.length, pad, width),
    y: point.value === null ? null : scaleY(point.value, scale, box, pad),
  }));
  const last = [...plotted].reverse().find((point) => point.y !== null);
  const slot = (width - pad.left - pad.right) / Math.max(points.length, 1);

  const show = (point: PlottedPoint) => () =>
    setTip({
      x: point.x / width,
      y: (point.y ?? floor) / box,
      title: point.label,
      rows: rowsFor(point, suffix, SERIES_SWATCH[series]),
    });

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${width} ${box}`} className="w-full" {...props}>
        {compact ? null : (
          <PlotAxes scale={scale} ticks={ticks} height={box} pad={pad} width={width} />
        )}

        {band ? (
          <PlotBandMark band={band} scale={scale} height={box} pad={pad} width={width} />
        ) : null}
        {reference ? (
          <PlotReferenceMark
            reference={reference}
            scale={scale}
            height={box}
            pad={pad}
            width={width}
          />
        ) : null}

        {runsOf(plotted).map((run) => (
          <polyline
            key={run[0]?.key}
            points={run.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={SERIES_STROKE[series]}
          />
        ))}

        {plotted.map((point) =>
          point.y === null ? null : (
            <circle
              key={point.key}
              cx={point.x}
              cy={point.y}
              r={point.index === last?.index ? 8 : 5}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className={cn(SERIES_FILL[series], 'stroke-chart-surface')}
            />
          ),
        )}

        {last && !compact ? (
          <text
            x={Math.min(last.x + 14, width - 6)}
            y={Math.max((last.y ?? floor) - 16, 20)}
            textAnchor={last.x > width - 140 ? 'end' : 'start'}
            fontSize={26}
            fontWeight={600}
            className="fill-foreground"
          >
            {textFor(last, suffix)}
          </text>
        ) : null}

        {compact || !xLabels
          ? null
          : plotted.map((point) =>
              labelled(point.index, points.length) ? (
                <text
                  key={`x-${point.key}`}
                  x={point.x}
                  y={box - 12}
                  textAnchor="middle"
                  fontSize={22}
                  className="fill-chart-ink"
                >
                  {point.label}
                </text>
              ) : null,
            )}

        {plotted.map((point) => (
          <rect
            key={`hit-${point.key}`}
            x={point.x - slot / 2}
            y={pad.top}
            width={slot}
            height={Math.max(floor - pad.top, 0)}
            tabIndex={0}
            role="img"
            aria-label={`${point.label}: ${textFor(point, suffix)}`}
            className="fill-transparent"
            onPointerEnter={show(point)}
            onFocus={show(point)}
            onPointerLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
          />
        ))}
      </svg>
      <ChartTooltip tip={tip} />
    </div>
  );
}

interface AxisProps {
  scale: PlotScale;
  ticks?: readonly number[];
  height: number;
  pad: PlotPad;
  width: number;
}

function PlotAxes({ scale, ticks, height, pad, width }: Readonly<AxisProps>) {
  const lines = ticks ?? quarters(scale);
  const floor = height - pad.bottom;

  return (
    <g>
      {lines.map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={scaleY(tick, scale, height, pad)}
            y2={scaleY(tick, scale, height, pad)}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="stroke-chart-grid"
          />
          <text
            x={pad.left - 10}
            y={scaleY(tick, scale, height, pad) + 7}
            textAnchor="end"
            fontSize={22}
            className="fill-chart-ink"
          >
            {tick}
          </text>
        </g>
      ))}
      <line
        x1={pad.left}
        x2={width - pad.right}
        y1={floor}
        y2={floor}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-chart-axis"
      />
    </g>
  );
}

function PlotBandMark({
  band,
  scale,
  height,
  pad,
  width,
}: Readonly<{ band: PlotBand; scale: PlotScale; height: number; pad: PlotPad; width: number }>) {
  const top = scaleY(band.to, scale, height, pad);
  const bottom = scaleY(band.from, scale, height, pad);

  return (
    <g>
      <rect
        x={pad.left}
        y={Math.min(top, bottom)}
        width={width - pad.left - pad.right}
        height={Math.abs(bottom - top)}
        className="fill-muted-foreground/15"
      />
      <text
        x={width - pad.right - 6}
        y={Math.min(top, bottom) - 8}
        textAnchor="end"
        fontSize={20}
        className="fill-chart-ink"
      >
        {band.label}
      </text>
    </g>
  );
}

function PlotReferenceMark({
  reference,
  scale,
  height,
  pad,
  width,
}: Readonly<{
  reference: PlotReference;
  scale: PlotScale;
  height: number;
  pad: PlotPad;
  width: number;
}>) {
  const y = scaleY(reference.value, scale, height, pad);
  const good = reference.tone === 'good';

  return (
    <g>
      <line
        x1={pad.left}
        x2={width - pad.right}
        y1={y}
        y2={y}
        strokeWidth={good ? 2 : 1}
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
        className={good ? 'stroke-success' : 'stroke-chart-axis'}
      />
      <text
        x={width - pad.right - 6}
        y={y - 10}
        textAnchor="end"
        fontSize={20}
        className="fill-chart-ink"
      >
        {reference.label}
      </text>
    </g>
  );
}

/** Unmeasured reads as a dash. Coercing it to 0 would claim the student scored nothing. */
function textFor(point: LinePoint, suffix: string): string {
  if (point.display !== undefined) return point.display;
  if (point.value === null) return '—';
  return `${point.value}${suffix}`;
}

function rowsFor(point: LinePoint, suffix: string, swatch: string) {
  const rows = [{ key: 'value', value: textFor(point, suffix), swatch }];
  if (point.caption === undefined) return rows;
  return [...rows, { key: 'caption', value: point.caption }];
}

/** Consecutive measured points only: a gap in the data is a gap in the line. */
function runsOf(points: readonly PlottedPoint[]): PlottedPoint[][] {
  const runs: PlottedPoint[][] = [];
  let open: PlottedPoint[] = [];

  for (const point of points) {
    if (point.y === null) {
      if (open.length > 1) runs.push(open);
      open = [];
      continue;
    }
    open.push(point);
  }
  if (open.length > 1) runs.push(open);
  return runs;
}

function quarters(scale: PlotScale): number[] {
  const step = (scale.max - scale.min) / 4;
  return [0, 1, 2, 3, 4].map((n) => Math.round(scale.min + n * step));
}

/** Past six points the axis thins out, and the last one is always named. */
function labelled(index: number, count: number): boolean {
  if (count <= MAX_X_LABELS) return true;
  if (index === count - 1) return true;
  return index % Math.ceil(count / MAX_X_LABELS) === 0;
}
