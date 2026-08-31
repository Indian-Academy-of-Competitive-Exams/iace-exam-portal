import * as React from 'react';
import { cn } from '../../lib/utils';
import { PLOT_WIDTH, barPath, type PlotPad } from './chart-geometry';
import { ChartTooltip, type ChartTip } from './chart-tooltip';

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
  height?: number;
  /** A wider viewBox for a wider card keeps the type the same size on screen. */
  width?: number;
  'aria-label': string;
  className?: string;
}

const PAD: PlotPad = { left: 44, right: 32, top: 96, bottom: 46 };
const DEFAULT_HEIGHT = 420;
const GAP = 3;

/** The end ticks hang off their own axis otherwise, and the last one gets clipped. */
const TICK_ANCHORS = ['start', 'middle', 'end'] as const;

const MARKER_STROKE = {
  you: 'stroke-series-1',
  good: 'stroke-success',
  neutral: 'stroke-chart-axis',
} as const;

/** No bands draws NOTHING: an un-rolled-up histogram is unknown, and a flat one reads as measured. */
export function DistributionPlot({
  bands,
  markers = [],
  max,
  min = 0,
  axisSuffix = '',
  countLabel,
  height = DEFAULT_HEIGHT,
  width = PLOT_WIDTH,
  className,
  ...props
}: Readonly<DistributionPlotProps>) {
  const [tip, setTip] = React.useState<ChartTip | null>(null);

  if (bands.length === 0) return null;

  const floor = height - PAD.bottom;
  const span = width - PAD.left - PAD.right;
  const range = Math.max(max - min, 1);
  const atX = (value: number) => PAD.left + ((value - min) / range) * span;
  const tallest = Math.max(...bands.map((band) => band.count), 1);

  const unit = axisSuffix ? ` ${axisSuffix}` : '';
  const show = (band: DistributionBand, index: number) => () =>
    setTip({
      x: (atX(band.from) + atX(band.to)) / 2 / width,
      y: (floor - (band.count / tallest) * (floor - PAD.top)) / height,
      title: `${band.from}–${band.to}${unit}`,
      rows: [{ key: `count-${index}`, value: String(band.count), label: countLabel }],
    });

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" {...props}>
        {bands.map((band) => (
          <path
            key={`${band.from}-${band.to}`}
            d={barPath(
              {
                x: atX(band.from) + GAP / 2,
                y: floor - (band.count / tallest) * (floor - PAD.top),
                width: Math.max(atX(band.to) - atX(band.from) - GAP, 1),
                height: (band.count / tallest) * (floor - PAD.top),
              },
              'top',
            )}
            className={band.isYours ? 'fill-series-1' : 'fill-muted-foreground/45'}
          />
        ))}

        <line
          x1={PAD.left - 12}
          x2={width - PAD.right}
          y1={floor}
          y2={floor}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="stroke-chart-axis"
        />

        {markers.map((marker, index) => (
          <MarkerMark
            key={marker.key}
            marker={marker}
            x={atX(marker.value)}
            top={20 + index * 30}
            floor={floor}
          />
        ))}

        {[min, Math.round((min + max) / 2), max].map((tick, index) => (
          <text
            key={tick}
            x={atX(tick)}
            y={height - 12}
            textAnchor={TICK_ANCHORS[index]}
            fontSize={22}
            className="fill-chart-ink"
          >
            {index === 2 && axisSuffix ? `${tick} ${axisSuffix}` : tick}
          </text>
        ))}

        {bands.map((band, index) => (
          <rect
            key={`hit-${band.from}-${band.to}`}
            x={atX(band.from)}
            y={PAD.top}
            width={Math.max(atX(band.to) - atX(band.from), 1)}
            height={Math.max(floor - PAD.top, 0)}
            tabIndex={0}
            role="img"
            aria-label={`${band.from}–${band.to}: ${band.count}`}
            className="fill-transparent"
            onPointerEnter={show(band, index)}
            onFocus={show(band, index)}
            onPointerLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
          />
        ))}
      </svg>
      <ChartTooltip tip={tip} />
    </div>
  );
}

function MarkerMark({
  marker,
  x,
  top,
  floor,
}: Readonly<{ marker: DistributionMarker; x: number; top: number; floor: number }>) {
  const tone = marker.tone ?? 'neutral';

  return (
    <g>
      <line
        x1={x}
        x2={x}
        y1={top + 10}
        y2={floor}
        strokeWidth={tone === 'you' ? 3 : 2}
        strokeDasharray={tone === 'neutral' ? '8 6' : undefined}
        vectorEffect="non-scaling-stroke"
        className={MARKER_STROKE[tone]}
      />
      <text
        x={x}
        y={top}
        textAnchor="middle"
        fontSize={22}
        fontWeight={tone === 'you' ? 700 : 400}
        className={tone === 'you' ? 'fill-foreground' : 'fill-chart-ink'}
      >
        {marker.label}
      </text>
    </g>
  );
}
