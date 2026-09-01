import {
  Bar,
  ComposedChart,
  LabelList,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  type DotItemDotProps,
  type XAxisTickContentProps,
} from 'recharts';
import {
  AXIS_LINE,
  BAR_MAX,
  BAR_RADIUS,
  CHART_VAR,
  CURSOR_BAND,
  PLOT_AXIS_WIDTH,
  PLOT_MARGIN,
  PLOT_TEXT,
  PlotText,
  PlotTickText,
  SERIES_SWATCH,
  SERIES_VAR,
  TIP_WRAPPER,
  UNMEASURED,
  type SeriesSlot,
} from './chart-theme';
import { PlotTip, type ChartTipRow } from './chart-tooltip';

export interface PlotColumn {
  key: string;
  label: string;
  /** Null is nothing attempted, which is not zero — it draws no column at all. */
  value: number | null;
  display?: string;
  /** The n behind the value, written under the column so it is never a bare percentage. */
  meta?: string;
  /** A second reading on the SAME scale, drawn as a tick across the column. */
  marker?: number | null;
  markerDisplay?: string;
  caption?: string;
}

export interface ColumnPlotProps {
  columns: readonly PlotColumn[];
  max?: number;
  min?: number;
  suffix?: string;
  series?: SeriesSlot;
  /** Pixels. */
  height?: number;
  'aria-label': string;
  className?: string;
}

const DEFAULT_HEIGHT = 320;
const X_AXIS_HEIGHT = 40;
const META_GAP = 15;
/** A measured zero still has to be seen and labelled; a null is what draws nothing. */
const ZERO_STUB = 2;
const MARKER_OVERHANG = 6;

/** One series, one hue: the column's height carries the value, its colour only says which series. */
export function ColumnPlot({
  columns,
  max = 100,
  min = 0,
  suffix = '',
  series = 1,
  height = DEFAULT_HEIGHT,
  className,
  ...props
}: Readonly<ColumnPlotProps>) {
  const marked = columns.some((column) => column.marker != null);

  return (
    <ComposedChart
      responsive
      data={[...columns]}
      height={height}
      margin={{ ...PLOT_MARGIN, left: PLOT_AXIS_WIDTH }}
      style={{ width: '100%', height }}
      className={className}
      {...props}
    >
      <XAxis
        dataKey="key"
        type="category"
        interval={0}
        height={X_AXIS_HEIGHT}
        axisLine={AXIS_LINE}
        tickLine={false}
        tickMargin={8}
        tick={<ColumnTick columns={columns} suffix={suffix} />}
      />
      <YAxis type="number" domain={[min, max]} hide />

      <Tooltip
        isAnimationActive={false}
        filterNull={false}
        cursor={CURSOR_BAND}
        wrapperStyle={TIP_WRAPPER}
        content={
          <PlotTip<PlotColumn>
            title={(column) => column.label}
            rows={(column) => rowsFor(column, suffix, SERIES_SWATCH[series])}
          />
        }
      />

      <Bar
        dataKey="value"
        fill={SERIES_VAR[series]}
        radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]}
        maxBarSize={BAR_MAX}
        minPointSize={ZERO_STUB}
        isAnimationActive={false}
      >
        <LabelList
          position="top"
          offset={8}
          className={PLOT_TEXT.value}
          valueAccessor={(entry) => textFor(entry.payload as PlotColumn, suffix)}
        />
      </Bar>

      {marked ? (
        <Line
          dataKey="marker"
          stroke="none"
          legendType="none"
          activeDot={false}
          isAnimationActive={false}
          dot={<MarkerTick />}
        />
      ) : null}
    </ComposedChart>
  );
}

interface MarkerTickProps {
  cx?: number;
  cy?: number;
  points?: DotItemDotProps['points'];
  payload?: PlotColumn;
}

/** The cohort's own reading, ticked across the column it is compared with. */
function MarkerTick({ cx, cy, points, payload }: Readonly<MarkerTickProps>) {
  if (cx === undefined || cy === undefined) return null;
  const reach = Math.min(BAR_MAX, bandOf(points)) / 2 + MARKER_OVERHANG;
  const label = payload?.markerDisplay;

  return (
    <g>
      <line
        x1={cx - reach}
        x2={cx + reach}
        y1={cy}
        y2={cy}
        strokeWidth={2}
        strokeDasharray="6 4"
        stroke={CHART_VAR.ink}
      />
      {label === undefined ? null : (
        <PlotText tone="meta" x={cx + reach + 5} y={cy + 4}>
          {label}
        </PlotText>
      )}
    </g>
  );
}

type ColumnTickProps = Partial<XAxisTickContentProps> & {
  columns: readonly PlotColumn[];
  suffix: string;
};

function ColumnTick({
  x,
  y,
  payload,
  width,
  visibleTicksCount,
  columns,
  suffix,
}: Readonly<ColumnTickProps>) {
  const column = columns[payload?.index ?? -1];
  if (column === undefined) return null;

  const slot = visibleTicksCount ?? 0;
  const room = typeof width === 'number' && slot > 0 ? width / slot : 0;
  const at = Number(x);
  const foot = Number(y);

  return (
    <g>
      {column.value === null ? (
        <PlotText tone="value" x={at} y={foot} dy={-16} textAnchor="middle">
          {textFor(column, suffix)}
        </PlotText>
      ) : null}
      <PlotTickText x={at} y={foot} width={room > 0 ? room : undefined}>
        {column.label}
      </PlotTickText>
      {column.meta === undefined ? null : (
        <PlotTickText x={at} y={foot + META_GAP} width={room > 0 ? room : undefined} tone="meta">
          {column.meta}
        </PlotTickText>
      )}
    </g>
  );
}

/** A band is the gap between two neighbours; one column alone gets the cap. */
function bandOf(points: DotItemDotProps['points'] | undefined): number {
  const first = points?.[0]?.x;
  const second = points?.[1]?.x;
  if (first == null || second == null) return BAR_MAX;
  return Math.abs(second - first);
}

function textFor(column: PlotColumn, suffix: string): string {
  if (column.display !== undefined) return column.display;
  if (column.value === null) return UNMEASURED;
  return `${column.value}${suffix}`;
}

function rowsFor(column: PlotColumn, suffix: string, swatch: string): ChartTipRow[] {
  const rows: ChartTipRow[] = [{ key: 'value', value: textFor(column, suffix), swatch }];
  if (column.meta !== undefined) rows.push({ key: 'meta', value: column.meta });
  if (column.caption !== undefined) rows.push({ key: 'caption', value: column.caption });
  return rows;
}
