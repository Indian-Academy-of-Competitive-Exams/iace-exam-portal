import {
  Bar,
  BarChart,
  Rectangle,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type CartesianViewBox,
  type LabelProps,
  type YAxisTickContentProps,
} from 'recharts';
import {
  BAR_MAX,
  BAR_RADIUS,
  CHART_VAR,
  CURSOR_BAND,
  PlotText,
  PlotTickText,
  SERIES_SWATCH,
  SERIES_VAR,
  TIP_WRAPPER,
  UNMEASURED,
  type SeriesSlot,
} from './chart-theme';
import { PlotTip, type ChartTipRow } from './chart-tooltip';

export interface DivergingItem {
  key: string;
  label: string;
  /** Signed: below the middle is negative. Null is unmeasured, and draws no bar. */
  value: number | null;
  display?: string;
  caption?: string;
}

export interface DivergingBarsProps {
  items: readonly DivergingItem[];
  /** The widest bar either way. Defaults to the largest size present. */
  max?: number;
  belowSeries?: SeriesSlot;
  aboveSeries?: SeriesSlot;
  /** Named under the axis so the two directions never rely on hue alone. */
  belowLabel?: string;
  aboveLabel?: string;
  /** The label gutter. Widen it where the names are long — a subject, not a section. */
  labelWidth?: number;
  'aria-label': string;
  className?: string;
}

const LABEL_WIDTH = 132;
const ROW_HEIGHT = 34;
const TOP = 8;
const FOOT = 24;
const FOOT_GAP = 16;
const LABEL_GAP = 8;

const isBelow = (item: DivergingItem) => (item.value ?? 0) < 0;

/** Every bar carries its signed value: the middle is what the reader is measured against. */
export function DivergingBars({
  items,
  max,
  belowSeries = 4,
  aboveSeries = 1,
  belowLabel,
  aboveLabel,
  labelWidth = LABEL_WIDTH,
  className,
  ...props
}: Readonly<DivergingBarsProps>) {
  const height = TOP + items.length * ROW_HEIGHT + FOOT;
  const ceiling = Math.max(max ?? 0, ...items.map((item) => Math.abs(item.value ?? 0)), 1);

  return (
    <BarChart
      responsive
      layout="vertical"
      data={[...items]}
      height={height}
      margin={{ top: TOP, right: 56, bottom: FOOT, left: 0 }}
      style={{ width: '100%', height }}
      className={className}
      {...props}
    >
      <XAxis type="number" domain={[-ceiling, ceiling]} hide />
      <YAxis
        type="category"
        dataKey="key"
        width={labelWidth}
        axisLine={false}
        tickLine={false}
        tick={<ItemTick items={items} labelWidth={labelWidth} />}
      />

      <Tooltip
        isAnimationActive={false}
        filterNull={false}
        cursor={CURSOR_BAND}
        wrapperStyle={TIP_WRAPPER}
        content={
          <PlotTip<DivergingItem>
            title={(item) => item.label}
            rows={(item) => rowsFor(item, SERIES_SWATCH[isBelow(item) ? belowSeries : aboveSeries])}
          />
        }
      />

      <ReferenceLine
        x={0}
        ifOverflow="visible"
        stroke={CHART_VAR.axis}
        label={<DirectionLabels below={belowLabel} above={aboveLabel} />}
      />

      <Bar
        dataKey="value"
        maxBarSize={BAR_MAX}
        isAnimationActive={false}
        shape={<DivergingBar below={SERIES_VAR[belowSeries]} above={SERIES_VAR[aboveSeries]} />}
      />

      {items.map((item) => (
        <ReferenceDot
          key={item.key}
          x={item.value ?? 0}
          y={item.key}
          r={0}
          ifOverflow="visible"
          fill="none"
          stroke="none"
          label={<TipLabel item={item} />}
        />
      ))}
    </BarChart>
  );
}

type DivergingBarProps = Partial<BarShapeProps> & { below: string; above: string };

/** 4px rounded at the data end, square where it leaves the middle. */
function DivergingBar({ x, y, width, height, payload, below, above }: Readonly<DivergingBarProps>) {
  if (x == null || y == null || width == null || height == null) return null;
  const item = payload as DivergingItem | undefined;
  const under = item !== undefined && isBelow(item);

  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill={under ? below : above}
      radius={under ? [BAR_RADIUS, 0, 0, BAR_RADIUS] : [0, BAR_RADIUS, BAR_RADIUS, 0]}
    />
  );
}

type TipLabelProps = Pick<LabelProps, 'viewBox'> & { item: DivergingItem };

/** The reading rides the tip of its own bar, so a null lands on the middle as a dash. */
function TipLabel({ item, viewBox }: Readonly<TipLabelProps>) {
  const span = viewBox as CartesianViewBox | undefined;
  if (span?.x === undefined || span.y === undefined) return null;
  const under = isBelow(item);

  return (
    <PlotText
      tone="value"
      x={under ? span.x - LABEL_GAP : span.x + LABEL_GAP}
      y={span.y + 4}
      textAnchor={under ? 'end' : 'start'}
    >
      {textFor(item)}
    </PlotText>
  );
}

type DirectionLabelsProps = Pick<LabelProps, 'viewBox'> & { below?: string; above?: string };

function DirectionLabels({ below, above, viewBox }: Readonly<DirectionLabelsProps>) {
  const span = viewBox as CartesianViewBox | undefined;
  if (span?.x === undefined) return null;
  const foot = (span.y ?? 0) + (span.height ?? 0) + FOOT_GAP;

  return (
    <g>
      {below === undefined ? null : (
        <PlotText tone="axis" x={span.x - LABEL_GAP} y={foot} textAnchor="end">
          {below}
        </PlotText>
      )}
      {above === undefined ? null : (
        <PlotText tone="axis" x={span.x + LABEL_GAP} y={foot}>
          {above}
        </PlotText>
      )}
    </g>
  );
}

type ItemTickProps = Partial<YAxisTickContentProps> & {
  items: readonly DivergingItem[];
  labelWidth: number;
};

function ItemTick({ x, y, payload, items, labelWidth }: Readonly<ItemTickProps>) {
  const item = items[payload?.index ?? -1];
  if (item === undefined) return null;

  return (
    <PlotTickText
      x={Number(x)}
      y={Number(y)}
      width={labelWidth - LABEL_GAP}
      anchor="end"
      vertical="middle"
    >
      {item.label}
    </PlotTickText>
  );
}

/** An unmeasured gap is a dash, never a zero-length bar sitting on the middle. */
function textFor(item: DivergingItem): string {
  if (item.display !== undefined) return item.display;
  if (item.value === null) return UNMEASURED;
  if (item.value > 0) return `+${item.value}`;
  if (item.value < 0) return `−${Math.abs(item.value)}`;
  return '0';
}

function rowsFor(item: DivergingItem, swatch: string): ChartTipRow[] {
  const rows: ChartTipRow[] = [{ key: 'value', value: textFor(item), swatch }];
  if (item.caption === undefined) return rows;
  return [...rows, { key: 'caption', value: item.caption }];
}
