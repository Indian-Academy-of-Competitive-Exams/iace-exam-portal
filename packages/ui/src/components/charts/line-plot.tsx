import * as React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type CartesianViewBox,
  type LabelProps,
  type XAxisTickContentProps,
  type YAxisTickContentProps,
} from 'recharts';
import {
  AXIS_LINE,
  CHART_VAR,
  CURSOR_LINE,
  DOT_RADIUS,
  DOT_RING,
  LINE_WIDTH,
  PLOT_AXIS_WIDTH,
  PLOT_MARGIN,
  PlotText,
  PlotTickText,
  SERIES_SWATCH,
  SERIES_VAR,
  TIP_WRAPPER,
  UNMEASURED,
  anchorAt,
  type SeriesSlot,
} from './chart-theme';
import { PlotTip, type ChartTipRow } from './chart-tooltip';

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
  /** Pixels. */
  height?: number;
  'aria-label': string;
  className?: string;
}

const DEFAULT_HEIGHT = 280;
const COMPACT_HEIGHT = 88;
const COMPACT_MARGIN = { top: 12, right: 10, bottom: 8, left: 10 } as const;
const X_AXIS_HEIGHT = 24;

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
  className,
  ...props
}: Readonly<LinePlotProps>) {
  const box = height ?? (compact ? COMPACT_HEIGHT : DEFAULT_HEIGHT);
  const colour = SERIES_VAR[series];
  const lastMeasured = [...points].reverse().find((point) => point.value !== null);
  const activeDot = React.useMemo(
    () => ({ r: DOT_RADIUS + 2, fill: colour, stroke: CHART_VAR.surface, strokeWidth: DOT_RING }),
    [colour],
  );

  return (
    <LineChart
      responsive
      data={[...points]}
      height={box}
      margin={compact ? COMPACT_MARGIN : PLOT_MARGIN}
      style={{ width: '100%', height: box }}
      className={className}
      {...props}
    >
      {compact ? null : <CartesianGrid horizontal vertical={false} stroke={CHART_VAR.grid} />}

      <XAxis
        dataKey="key"
        type="category"
        scale={align === 'bands' ? 'band' : 'point'}
        hide={compact || !xLabels}
        height={X_AXIS_HEIGHT}
        axisLine={AXIS_LINE}
        tickLine={false}
        tickMargin={6}
        tickFormatter={(_value, index) => points[index]?.label ?? ''}
        tick={<PointTick points={points} />}
      />
      <YAxis
        type="number"
        domain={[min, max]}
        ticks={ticks === undefined ? undefined : [...ticks]}
        hide={compact}
        width={PLOT_AXIS_WIDTH}
        axisLine={false}
        tickLine={false}
        tick={<ValueTick />}
      />

      {band ? (
        <ReferenceArea
          y1={band.from}
          y2={band.to}
          ifOverflow="visible"
          fill={CHART_VAR.muted}
          fillOpacity={0.15}
          label={<OverLine text={band.label} />}
        />
      ) : null}
      {reference ? (
        <ReferenceLine
          y={reference.value}
          ifOverflow="visible"
          stroke={reference.tone === 'good' ? CHART_VAR.success : CHART_VAR.axis}
          strokeWidth={reference.tone === 'good' ? 2 : 1}
          strokeDasharray="6 4"
          label={<OverLine text={reference.label} />}
        />
      ) : null}

      <Tooltip
        isAnimationActive={false}
        filterNull={false}
        cursor={CURSOR_LINE}
        wrapperStyle={TIP_WRAPPER}
        content={
          <PlotTip<LinePoint>
            title={(point) => point.label}
            rows={(point) => rowsFor(point, suffix, SERIES_SWATCH[series])}
          />
        }
      />

      <Line
        dataKey="value"
        type="linear"
        stroke={colour}
        strokeWidth={LINE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        connectNulls={false}
        isAnimationActive={false}
        activeDot={activeDot}
        dot={
          <PointDot
            colour={colour}
            lastKey={lastMeasured?.key}
            count={points.length}
            suffix={suffix}
            labelled={!compact}
          />
        }
      />
    </LineChart>
  );
}

/** Above the line at its right end: Recharts' own inside positions land the label on top of it. */
function OverLine({ text, viewBox }: Readonly<{ text: string } & Pick<LabelProps, 'viewBox'>>) {
  const span = viewBox as CartesianViewBox | undefined;
  if (span?.x === undefined) return null;

  return (
    <PlotText tone="meta" x={span.x + (span.width ?? 0) - 4} y={(span.y ?? 0) - 6} textAnchor="end">
      {text}
    </PlotText>
  );
}

interface PointDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: LinePoint;
  colour: string;
  lastKey?: string;
  count: number;
  suffix: string;
  labelled: boolean;
}

/** The last measured point wears the reading; a 2px surface ring keeps every dot legible. */
function PointDot({
  cx,
  cy,
  index,
  payload,
  colour,
  lastKey,
  count,
  suffix,
  labelled,
}: Readonly<PointDotProps>) {
  if (payload?.value == null || cx === undefined || cy === undefined) return null;

  const isLast = payload.key === lastKey;
  const atEnd = index === count - 1;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={isLast ? DOT_RADIUS + 2 : DOT_RADIUS}
        fill={colour}
        stroke={CHART_VAR.surface}
        strokeWidth={DOT_RING}
      />
      {isLast && labelled ? (
        <PlotText
          tone="value"
          x={atEnd ? cx - 8 : cx + 10}
          y={Math.max(cy - 12, 14)}
          textAnchor={atEnd ? 'end' : 'start'}
        >
          {textFor(payload, suffix)}
        </PlotText>
      ) : null}
    </g>
  );
}

type PointTickProps = Partial<XAxisTickContentProps> & { points: readonly LinePoint[] };

function PointTick({ x, y, payload, width, visibleTicksCount, points }: Readonly<PointTickProps>) {
  const index = payload?.index ?? -1;
  const label = points[index]?.label;
  if (label === undefined) return null;

  const slot = visibleTicksCount ?? 0;
  const room = typeof width === 'number' && slot > 0 ? width / slot : 0;

  return (
    <PlotTickText
      x={Number(x)}
      y={Number(y)}
      width={room > 0 ? room : undefined}
      anchor={anchorAt(index, points.length)}
    >
      {label}
    </PlotTickText>
  );
}

function ValueTick({ x, y, payload, textAnchor }: Readonly<Partial<YAxisTickContentProps>>) {
  return (
    <PlotText tone="axis" x={x} y={y} dy={4} textAnchor={textAnchor}>
      {String(payload?.value ?? '')}
    </PlotText>
  );
}

/** Unmeasured reads as a dash. Coercing it to 0 would claim the student scored nothing. */
function textFor(point: LinePoint, suffix: string): string {
  if (point.display !== undefined) return point.display;
  if (point.value === null) return UNMEASURED;
  return `${point.value}${suffix}`;
}

function rowsFor(point: LinePoint, suffix: string, swatch: string): ChartTipRow[] {
  const rows: ChartTipRow[] = [{ key: 'value', value: textFor(point, suffix), swatch }];
  if (point.caption === undefined) return rows;
  return [...rows, { key: 'caption', value: point.caption }];
}
