import * as React from 'react';
import { cn } from '../../lib/utils';
import {
  PLOT_PAD,
  PLOT_WIDTH,
  SERIES_FILL,
  SERIES_SWATCH,
  bandWidth,
  bandX,
  barPath,
  scaleY,
  type PlotPad,
  type PlotScale,
  type SeriesSlot,
} from './chart-geometry';
import { ChartTooltip, type ChartTip, type ChartTipRow } from './chart-tooltip';

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
  height?: number;
  /** A wider viewBox for a wider card keeps the type the same size on screen. */
  width?: number;
  'aria-label': string;
  className?: string;
}

/** Left and right come from the shared pad, so a line plot stacked above lands on the same bands. */
const PAD: PlotPad = { ...PLOT_PAD, top: 64, bottom: 104 };
const DEFAULT_HEIGHT = 560;
const FAINTEST = 0.5;

/** Ordered bands on one hue, light to dark, every value written on its cap. */
export function ColumnPlot({
  columns,
  max = 100,
  min = 0,
  suffix = '',
  series = 1,
  height = DEFAULT_HEIGHT,
  width = PLOT_WIDTH,
  className,
  ...props
}: Readonly<ColumnPlotProps>) {
  const [tip, setTip] = React.useState<ChartTip | null>(null);
  const scale: PlotScale = { min, max };
  const floor = height - PAD.bottom;
  const bar = bandWidth(columns.length, width);

  const show = (column: PlotColumn, index: number) => () =>
    setTip({
      x: bandX(index, columns.length, PAD, width) / width,
      y: (column.value === null ? floor : scaleY(column.value, scale, height, PAD)) / height,
      title: column.label,
      rows: rowsFor(column, suffix, SERIES_SWATCH[series]),
    });

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" {...props}>
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={floor}
          y2={floor}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="stroke-chart-axis"
        />

        {columns.map((column, index) => (
          <Column
            key={column.key}
            column={column}
            x={bandX(index, columns.length, PAD, width)}
            width={bar}
            floor={floor}
            top={column.value === null ? floor : scaleY(column.value, scale, height, PAD)}
            markerTop={column.marker == null ? null : scaleY(column.marker, scale, height, PAD)}
            shade={shadeOf(index, columns.length)}
            fill={SERIES_FILL[series]}
            suffix={suffix}
          />
        ))}

        {columns.map((column, index) => (
          <rect
            key={`hit-${column.key}`}
            x={bandX(index, columns.length, PAD, width) - bar}
            y={PAD.top}
            width={bar * 2}
            height={Math.max(floor - PAD.top, 0)}
            tabIndex={0}
            role="img"
            aria-label={`${column.label}: ${textFor(column, suffix)}`}
            className="fill-transparent"
            onPointerEnter={show(column, index)}
            onFocus={show(column, index)}
            onPointerLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
          />
        ))}
      </svg>
      <ChartTooltip tip={tip} />
    </div>
  );
}

interface ColumnProps {
  column: PlotColumn;
  x: number;
  width: number;
  floor: number;
  top: number;
  markerTop: number | null;
  shade: number;
  fill: string;
  suffix: string;
}

function Column({
  column,
  x,
  width,
  floor,
  top,
  markerTop,
  shade,
  fill,
  suffix,
}: Readonly<ColumnProps>) {
  return (
    <g>
      {column.value === null ? null : (
        <path
          d={barPath({ x: x - width / 2, y: top, width, height: Math.max(floor - top, 0) }, 'top')}
          fillOpacity={shade}
          className={fill}
        />
      )}
      <text
        x={x}
        y={top - 16}
        textAnchor="middle"
        fontSize={28}
        fontWeight={700}
        className="fill-foreground"
      >
        {textFor(column, suffix)}
      </text>
      {markerTop === null ? null : (
        <MarkerTick x={x} y={markerTop} width={width} label={column.markerDisplay} />
      )}
      <text x={x} y={floor + 34} textAnchor="middle" fontSize={23} className="fill-chart-ink">
        {column.label}
      </text>
      {column.meta ? (
        <text
          x={x}
          y={floor + 64}
          textAnchor="middle"
          fontSize={20}
          className="fill-muted-foreground"
        >
          {column.meta}
        </text>
      ) : null}
    </g>
  );
}

function MarkerTick({
  x,
  y,
  width,
  label,
}: Readonly<{ x: number; y: number; width: number; label?: string }>) {
  return (
    <g>
      <line
        x1={x - width / 2 - 8}
        x2={x + width / 2 + 8}
        y1={y}
        y2={y}
        strokeWidth={2}
        strokeDasharray="8 5"
        vectorEffect="non-scaling-stroke"
        className="stroke-chart-ink"
      />
      {label ? (
        <text x={x + width / 2 + 14} y={y + 7} fontSize={19} className="fill-muted-foreground">
          {label}
        </text>
      ) : null}
    </g>
  );
}

/** One hue, light to dark across the ordered bands — a ramp, never eight unrelated colours. */
function shadeOf(index: number, count: number): number {
  if (count <= 1) return 1;
  return FAINTEST + (1 - FAINTEST) * (index / (count - 1));
}

function textFor(column: PlotColumn, suffix: string): string {
  if (column.display !== undefined) return column.display;
  if (column.value === null) return '—';
  return `${column.value}${suffix}`;
}

function rowsFor(column: PlotColumn, suffix: string, swatch: string): ChartTipRow[] {
  const rows: ChartTipRow[] = [{ key: 'value', value: textFor(column, suffix), swatch }];
  if (column.meta !== undefined) rows.push({ key: 'meta', value: column.meta });
  if (column.caption !== undefined) rows.push({ key: 'caption', value: column.caption });
  return rows;
}
