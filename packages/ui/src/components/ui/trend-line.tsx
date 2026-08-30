import { cn } from '../../lib/utils';

/** One point on the line. `caption` is what its hover says beyond the value. */
export interface TrendPoint {
  key: string;
  label: string;
  value: number;
  caption?: string;
}

export interface TrendLineProps {
  points: readonly TrendPoint[];
  /** The top of the scale. One axis, always — a second would be two charts pretending to be one. */
  max?: number;
  unit?: string;
  /** The line has no legend: one series is named by the heading above it. */
  'aria-label': string;
  className?: string;
}

/** The drawing box. Fixed, and the SVG scales into whatever width it is given. */
const BOX = { width: 640, height: 180, padX: 28, padY: 18 } as const;

/** Four gridlines read as a scale; more read as graph paper. */
const GRID = [0, 0.25, 0.5, 0.75, 1] as const;

/** One series over ordered points: 2px line, 8px markers, and a value only on the last one. */
export function TrendLine({
  points,
  max = 100,
  unit = '',
  className,
  ...props
}: Readonly<TrendLineProps>) {
  const ceiling = Math.max(max, ...points.map((point) => point.value), 1);
  const plotted = points.map((point, index) => ({
    ...point,
    x: xOf(index, points.length),
    y: BOX.padY + (1 - point.value / ceiling) * (BOX.height - BOX.padY * 2),
  }));
  const last = plotted.at(-1);

  return (
    <svg
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      role="img"
      className={cn('h-44 w-full', className)}
      preserveAspectRatio="none"
      {...props}
    >
      {GRID.map((step) => (
        <line
          key={step}
          x1={BOX.padX}
          x2={BOX.width - BOX.padX}
          y1={BOX.padY + step * (BOX.height - BOX.padY * 2)}
          y2={BOX.padY + step * (BOX.height - BOX.padY * 2)}
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />
      ))}

      {plotted.length > 1 ? (
        <polyline
          points={plotted.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {plotted.map((point) => (
        <circle
          key={point.key}
          cx={point.x}
          cy={point.y}
          r={5}
          fill="var(--series-1)"
          stroke="var(--chart-surface)"
          strokeWidth={2}
        >
          <title>{`${point.label}: ${point.value}${unit}${point.caption ? ` — ${point.caption}` : ''}`}</title>
        </circle>
      ))}

      {last ? (
        <text
          x={Math.min(last.x + 10, BOX.width - 4)}
          y={Math.max(last.y - 8, 12)}
          textAnchor={last.x > BOX.width - 80 ? 'end' : 'start'}
          fill="var(--chart-ink)"
          fontSize={12}
        >
          {`${last.value}${unit}`}
        </text>
      ) : null}
    </svg>
  );
}

/** A lone point sits in the middle rather than hard against the left edge. */
function xOf(index: number, count: number): number {
  const span = BOX.width - BOX.padX * 2;
  if (count <= 1) return BOX.padX + span / 2;
  return BOX.padX + (index / (count - 1)) * span;
}
