import {
  Bar,
  BarChart,
  Rectangle,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type CartesianViewBox,
  type LabelProps,
  type XAxisTickContentProps,
} from 'recharts';
import {
  AXIS_LINE,
  BAR_RADIUS,
  CHART_VAR,
  CURSOR_BAND,
  PlotText,
  SERIES_VAR,
  TIP_WRAPPER,
  anchorAt,
  type PlotTone,
} from './chart-theme';
import { PlotTip } from './chart-tooltip';

/** One column of a distribution: `from` inclusive, `to` exclusive, and how many landed in it. */
export interface DistributionBand {
  from: number;
  to: number;
  count: number;
  /** The one band the reader is standing in. */
  isYours?: boolean;
}

export interface DistributionMarker {
  key: string;
  label: string;
  value: number;
  tone?: 'you' | 'good' | 'neutral';
}

export interface DistributionPlotProps {
  bands: readonly DistributionBand[];
  markers?: readonly DistributionMarker[];
  max: number;
  min?: number;
  /** What one unit of the x-axis is, written once at its end. */
  axisSuffix?: string;
  /** What a count counts, said in the hover. */
  countLabel?: string;
  /** Pixels. */
  height?: number;
  'aria-label': string;
  className?: string;
}

interface DistributionRow extends DistributionBand {
  key: string;
  mid: number;
}

const DEFAULT_HEIGHT = 280;
const X_AXIS_HEIGHT = 22;
const MARKER_TOP = 14;
const MARKER_STEP = 15;
const BIN_GAP = 2;
const REST_OPACITY = 0.45;

const MARKER_STROKE = {
  you: SERIES_VAR[1],
  good: CHART_VAR.success,
  neutral: CHART_VAR.axis,
} as const;

const MARKER_TONE = {
  you: 'value',
  good: 'axis',
  neutral: 'axis',
} as const satisfies Record<keyof typeof MARKER_STROKE, PlotTone>;

/** No bands draws NOTHING: an un-rolled-up histogram is unknown, and a flat one reads as measured. */
export function DistributionPlot({
  bands,
  markers = [],
  max,
  min = 0,
  axisSuffix = '',
  countLabel,
  height = DEFAULT_HEIGHT,
  className,
  ...props
}: Readonly<DistributionPlotProps>) {
  if (bands.length === 0) return null;

  const rows: DistributionRow[] = bands.map((band) => ({
    ...band,
    key: `${band.from}-${band.to}`,
    mid: (band.from + band.to) / 2,
  }));
  const ticks = [min, Math.round((min + max) / 2), max];
  const unit = axisSuffix ? ` ${axisSuffix}` : '';

  return (
    <BarChart
      responsive
      data={rows}
      height={height}
      barCategoryGap={BIN_GAP}
      margin={{ top: MARKER_TOP + markers.length * MARKER_STEP, right: 12, bottom: 0, left: 12 }}
      style={{ width: '100%', height }}
      className={className}
      {...props}
    >
      <XAxis
        dataKey="mid"
        type="number"
        domain={[min, max]}
        ticks={ticks}
        height={X_AXIS_HEIGHT}
        axisLine={AXIS_LINE}
        tickLine={false}
        tickMargin={6}
        tick={<BandTick count={ticks.length} suffix={axisSuffix} />}
      />
      <YAxis type="number" dataKey="count" hide />

      <Tooltip
        isAnimationActive={false}
        filterNull={false}
        cursor={CURSOR_BAND}
        wrapperStyle={TIP_WRAPPER}
        content={
          <PlotTip<DistributionRow>
            title={(row) => `${row.from}–${row.to}${unit}`}
            rows={(row) => [{ key: row.key, value: String(row.count), label: countLabel }]}
          />
        }
      />

      <Bar dataKey="count" isAnimationActive={false} shape={<BinBar />} />

      {markers.map((marker, index) => (
        <ReferenceLine
          key={marker.key}
          x={marker.value}
          ifOverflow="visible"
          stroke={MARKER_STROKE[marker.tone ?? 'neutral']}
          strokeWidth={marker.tone === 'you' ? 3 : 2}
          strokeDasharray={marker.tone === 'neutral' ? '6 5' : undefined}
          label={<MarkerLabel marker={marker} row={index} />}
        />
      ))}
    </BarChart>
  );
}

/** The band the reader is standing in wears the hue; the rest of the cohort is a wash. */
function BinBar({ x, y, width, height, payload }: Readonly<Partial<BarShapeProps>>) {
  if (x == null || y == null || width == null || height == null) return null;
  const yours = (payload as DistributionRow | undefined)?.isYours === true;

  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill={yours ? SERIES_VAR[1] : CHART_VAR.muted}
      fillOpacity={yours ? 1 : REST_OPACITY}
      radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]}
    />
  );
}

type MarkerLabelProps = Pick<LabelProps, 'viewBox'> & {
  marker: DistributionMarker;
  /** Three markers on close scores would land on each other, so each one takes its own line. */
  row: number;
};

function MarkerLabel({ marker, row, viewBox }: Readonly<MarkerLabelProps>) {
  const span = viewBox as CartesianViewBox | undefined;
  if (span?.x === undefined) return null;

  return (
    <PlotText
      tone={MARKER_TONE[marker.tone ?? 'neutral']}
      x={span.x}
      y={MARKER_TOP + row * MARKER_STEP}
      textAnchor="middle"
    >
      {marker.label}
    </PlotText>
  );
}

type BandTickProps = Partial<XAxisTickContentProps> & { count: number; suffix: string };

function BandTick({ x, y, payload, count, suffix }: Readonly<BandTickProps>) {
  const index = payload?.index ?? 0;
  const last = index === count - 1;

  return (
    <PlotText tone="axis" x={x} y={y} dy={10} textAnchor={anchorAt(index, count)}>
      {last && suffix ? `${payload?.value} ${suffix}` : String(payload?.value ?? '')}
    </PlotText>
  );
}
