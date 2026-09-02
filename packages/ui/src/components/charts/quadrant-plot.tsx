import {
  LabelList,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type XAxisTickContentProps,
  type YAxisTickContentProps,
} from 'recharts';
import { cn } from '../../lib/utils';
import {
  AXIS_LINE,
  CHART_VAR,
  PLOT_MARGIN,
  PLOT_TEXT,
  PlotText,
  SERIES_SWATCH,
  SERIES_VAR,
  TIP_WRAPPER,
} from './chart-theme';
import { PlotTip, type ChartTipRow } from './chart-tooltip';

export interface QuadrantPoint {
  key: string;
  label: string;
  x: number;
  y: number;
  /** The n behind the dot, which also sizes it — a big dot is a reading, not an opinion. */
  weight: number;
  /** Too few behind it to read as a position: drawn as a wash so it cannot claim mastery. */
  faint?: boolean;
  caption?: string;
}

/** Named by the half of each axis they sit in, so a caller cannot mix up which corner is which. */
export interface QuadrantLabels {
  lowXHighY: string;
  highXHighY: string;
  lowXLowY: string;
  highXLowY: string;
}

export interface QuadrantPlotProps {
  points: readonly QuadrantPoint[];
  /** Where the two guides cross, each in its own axis's units. */
  xGuide: number;
  yGuide: number;
  quadrants: QuadrantLabels;
  xSuffix?: string;
  ySuffix?: string;
  yMax?: number;
  /** Pixels. */
  height?: number;
  'aria-label': string;
  className?: string;
}

const DEFAULT_HEIGHT = 320;
const X_AXIS_HEIGHT = 26;
const Y_AXIS_WIDTH = 34;
const DOT_AREA = [90, 420] as const;
const FAINT_OPACITY = 0.35;
/** Room past the outermost dot, so a label at the edge is not half outside the box. */
const X_PAD = 0.12;

const CORNER_CLASS = 'absolute text-2xs text-muted-foreground';

/** Two readings against two guides: which half of each a subject falls in is the whole message. */
export function QuadrantPlot({
  points,
  xGuide,
  yGuide,
  quadrants,
  xSuffix = '',
  ySuffix = '',
  yMax = 100,
  height = DEFAULT_HEIGHT,
  className,
  ...props
}: Readonly<QuadrantPlotProps>) {
  const xs = [...points.map((point) => point.x), xGuide];
  const pad = Math.max((Math.max(...xs) - Math.min(...xs)) * X_PAD, 1);
  const domain: [number, number] = [Math.max(0, Math.min(...xs) - pad), Math.max(...xs) + pad];
  // Recharts reads a dot's colour off the datum; `Cell` is deprecated and goes in v4.
  const dots = points.map((point) => ({
    ...point,
    fill: SERIES_VAR[1],
    fillOpacity: point.faint ? FAINT_OPACITY : 1,
  }));

  return (
    <div className={cn('relative', className)} style={{ height }}>
      <ScatterChart
        responsive
        height={height}
        margin={PLOT_MARGIN}
        style={{ width: '100%', height }}
        {...props}
      >
        <XAxis
          type="number"
          dataKey="x"
          domain={domain}
          height={X_AXIS_HEIGHT}
          axisLine={AXIS_LINE}
          tickLine={false}
          tickCount={4}
          tick={<FootTick suffix={xSuffix} />}
        />
        <YAxis
          type="number"
          dataKey="y"
          domain={[0, yMax]}
          width={Y_AXIS_WIDTH}
          axisLine={AXIS_LINE}
          tickLine={false}
          ticks={[0, yMax / 2, yMax]}
          tick={<SideTick suffix={ySuffix} />}
        />
        <ZAxis type="number" dataKey="weight" range={[...DOT_AREA]} />

        <ReferenceLine x={xGuide} stroke={CHART_VAR.axis} strokeDasharray="5 5" />
        <ReferenceLine y={yGuide} stroke={CHART_VAR.axis} strokeDasharray="5 5" />

        <Tooltip
          isAnimationActive={false}
          cursor={false}
          wrapperStyle={TIP_WRAPPER}
          content={
            <PlotTip<QuadrantPoint>
              title={(point) => point.label}
              rows={(point) => rowsFor(point, xSuffix, ySuffix)}
            />
          }
        />

        <Scatter data={dots} isAnimationActive={false}>
          <LabelList dataKey="label" position="top" offset={10} className={PLOT_TEXT.meta} />
        </Scatter>
      </ScatterChart>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ paddingLeft: Y_AXIS_WIDTH, paddingBottom: X_AXIS_HEIGHT }}
      >
        <div className="relative size-full">
          <span className={cn(CORNER_CLASS, 'left-1.5 top-1')}>{quadrants.lowXHighY}</span>
          <span className={cn(CORNER_CLASS, 'right-1.5 top-1')}>{quadrants.highXHighY}</span>
          <span className={cn(CORNER_CLASS, 'bottom-1 left-1.5')}>{quadrants.lowXLowY}</span>
          <span className={cn(CORNER_CLASS, 'bottom-1 right-1.5')}>{quadrants.highXLowY}</span>
        </div>
      </div>
    </div>
  );
}

function FootTick({ x, y, payload, suffix }: Readonly<TickProps<XAxisTickContentProps>>) {
  return (
    <PlotText tone="axis" x={x} y={y} dy={12} textAnchor="middle">
      {tickText(payload?.value, suffix)}
    </PlotText>
  );
}

function SideTick({ x, y, payload, suffix }: Readonly<TickProps<YAxisTickContentProps>>) {
  return (
    <PlotText tone="axis" x={x} y={y} dx={-6} dy={4} textAnchor="end">
      {tickText(payload?.value, suffix)}
    </PlotText>
  );
}

type TickProps<T> = Partial<T> & { suffix: string };

const tickText = (value: unknown, suffix: string) => `${Math.round(Number(value ?? 0))}${suffix}`;

function rowsFor(point: QuadrantPoint, xSuffix: string, ySuffix: string): ChartTipRow[] {
  const rows: ChartTipRow[] = [
    { key: 'y', value: `${point.y}${ySuffix}`, swatch: SERIES_SWATCH[1] },
    { key: 'x', value: `${point.x}${xSuffix}` },
  ];
  if (point.caption !== undefined) rows.push({ key: 'caption', value: point.caption });
  return rows;
}
