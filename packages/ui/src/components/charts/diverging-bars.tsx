import * as React from 'react';
import { cn } from '../../lib/utils';
import { PLOT_WIDTH, SERIES_FILL, SERIES_SWATCH, barPath, type SeriesSlot } from './chart-geometry';
import { ChartTooltip, type ChartTip } from './chart-tooltip';

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
  /** A wider viewBox for a wider card keeps the type the same size on screen. */
  width?: number;
  'aria-label': string;
  className?: string;
}

const LABEL_RIGHT = 250;
const AXIS = 620;
const REACH = 290;
const ROW = 84;
const BAR = 34;
const TOP = 22;
const FOOT = 40;

/** Every bar carries its signed value: the middle is what the reader is measured against. */
export function DivergingBars({
  items,
  max,
  belowSeries = 4,
  aboveSeries = 1,
  belowLabel,
  aboveLabel,
  width = PLOT_WIDTH,
  className,
  ...props
}: Readonly<DivergingBarsProps>) {
  const [tip, setTip] = React.useState<ChartTip | null>(null);
  const height = TOP + items.length * ROW + FOOT;
  const ceiling = Math.max(max ?? 0, ...items.map((item) => Math.abs(item.value ?? 0)), 1);
  const axisBottom = TOP + items.length * ROW;

  const show = (item: DivergingItem, index: number) => () =>
    setTip({
      x: AXIS / width,
      y: (TOP + index * ROW) / height,
      title: item.label,
      rows: rowsFor(item, SERIES_SWATCH[(item.value ?? 0) < 0 ? belowSeries : aboveSeries]),
    });

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" {...props}>
        <line
          x1={AXIS}
          x2={AXIS}
          y1={TOP - 10}
          y2={axisBottom + 6}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="stroke-chart-axis"
        />

        {items.map((item, index) => (
          <DivergingRow
            key={item.key}
            item={item}
            y={TOP + index * ROW}
            width={(Math.abs(item.value ?? 0) / ceiling) * REACH}
            fill={SERIES_FILL[(item.value ?? 0) < 0 ? belowSeries : aboveSeries]}
          />
        ))}

        {belowLabel ? (
          <text
            x={AXIS - 16}
            y={height - 12}
            textAnchor="end"
            fontSize={20}
            className="fill-chart-ink"
          >
            {belowLabel}
          </text>
        ) : null}
        {aboveLabel ? (
          <text x={AXIS + 16} y={height - 12} fontSize={20} className="fill-chart-ink">
            {aboveLabel}
          </text>
        ) : null}

        {items.map((item, index) => (
          <rect
            key={`hit-${item.key}`}
            x={0}
            y={TOP + index * ROW}
            width={width}
            height={ROW}
            tabIndex={0}
            role="img"
            aria-label={`${item.label}: ${textFor(item)}`}
            className="fill-transparent"
            onPointerEnter={show(item, index)}
            onFocus={show(item, index)}
            onPointerLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
          />
        ))}
      </svg>
      <ChartTooltip tip={tip} />
    </div>
  );
}

function DivergingRow({
  item,
  y,
  width,
  fill,
}: Readonly<{ item: DivergingItem; y: number; width: number; fill: string }>) {
  const below = (item.value ?? 0) < 0;
  const middle = y + ROW / 2;
  const tip = below ? AXIS - width : AXIS + width;

  return (
    <g>
      <text
        x={LABEL_RIGHT}
        y={middle + 8}
        textAnchor="end"
        fontSize={24}
        className="fill-chart-ink"
      >
        {item.label}
      </text>
      {item.value === null || width < 1 ? null : (
        <path
          d={barPath(
            { x: below ? AXIS - width : AXIS, y: middle - BAR / 2, width, height: BAR },
            below ? 'left' : 'right',
          )}
          className={fill}
        />
      )}
      <text
        x={below ? tip - 12 : tip + 12}
        y={middle + 8}
        textAnchor={below ? 'end' : 'start'}
        fontSize={22}
        fontWeight={600}
        className="fill-foreground"
      >
        {textFor(item)}
      </text>
    </g>
  );
}

/** An unmeasured gap is a dash, never a zero-length bar sitting on the middle. */
function textFor(item: DivergingItem): string {
  if (item.display !== undefined) return item.display;
  if (item.value === null) return '—';
  if (item.value > 0) return `+${item.value}`;
  if (item.value < 0) return `−${Math.abs(item.value)}`;
  return '0';
}

function rowsFor(item: DivergingItem, swatch: string) {
  const rows = [{ key: 'value', value: textFor(item), swatch }];
  if (item.caption === undefined) return rows;
  return [...rows, { key: 'caption', value: item.caption }];
}
