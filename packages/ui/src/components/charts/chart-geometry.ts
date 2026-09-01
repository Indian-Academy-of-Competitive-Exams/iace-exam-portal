/**
 * The geometry every plot in this folder shares: one viewBox width, one set of
 * paddings, one bar shape. Two plots stacked under a single x-axis line up
 * because both measured from here, not because someone matched them by eye.
 */

export const PLOT_WIDTH = 1000;

/** A full-width plot takes this instead, so its type lands the same size as a half-width one's. */
export const PLOT_WIDTH_WIDE = 2000;

export interface PlotPad {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const PLOT_PAD: PlotPad = { left: 64, right: 28, top: 30, bottom: 46 };

/** A sparkline has no axis to leave room for — only enough air for the end marker. */
export const PLOT_PAD_COMPACT: PlotPad = { left: 14, right: 14, top: 16, bottom: 14 };

/** Assigned in fixed order, never cycled — a ninth series folds into Other instead. */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SERIES_FILL = {
  1: 'fill-series-1',
  2: 'fill-series-2',
  3: 'fill-series-3',
  4: 'fill-series-4',
  5: 'fill-series-5',
  6: 'fill-series-6',
  7: 'fill-series-7',
  8: 'fill-series-8',
} as const satisfies Record<SeriesSlot, string>;

export const SERIES_STROKE = {
  1: 'stroke-series-1',
  2: 'stroke-series-2',
  3: 'stroke-series-3',
  4: 'stroke-series-4',
  5: 'stroke-series-5',
  6: 'stroke-series-6',
  7: 'stroke-series-7',
  8: 'stroke-series-8',
} as const satisfies Record<SeriesSlot, string>;

export const SERIES_SWATCH = {
  1: 'bg-series-1',
  2: 'bg-series-2',
  3: 'bg-series-3',
  4: 'bg-series-4',
  5: 'bg-series-5',
  6: 'bg-series-6',
  7: 'bg-series-7',
  8: 'bg-series-8',
} as const satisfies Record<SeriesSlot, string>;

/** Points sit ON the edges of the plot; a lone one sits in the middle of it. */
export function pointX(
  index: number,
  count: number,
  pad: PlotPad = PLOT_PAD,
  width: number = PLOT_WIDTH,
): number {
  const span = width - pad.left - pad.right;
  if (count <= 1) return pad.left + span / 2;
  return pad.left + (index / (count - 1)) * span;
}

/** Columns sit in the MIDDLE of their band, so the first one is not half off the axis. */
export function bandX(
  index: number,
  count: number,
  pad: PlotPad = PLOT_PAD,
  width: number = PLOT_WIDTH,
): number {
  const span = width - pad.left - pad.right;
  return pad.left + ((index + 0.5) / Math.max(count, 1)) * span;
}

export function bandWidth(count: number, width: number = PLOT_WIDTH, cap = 96): number {
  const span = width - PLOT_PAD.left - PLOT_PAD.right;
  return Math.min(cap, (span / Math.max(count, 1)) * 0.62);
}

/** Rough advance width of one character at the size axis labels are set in. */
const LABEL_CHAR = 11;

/** SVG has no ellipsis: a label wider than its own slot silently smears into its neighbour. */
export function fitLabel(text: string, slot: number): string {
  const room = Math.floor(slot / LABEL_CHAR);
  if (text.length <= room) return text;
  return `${text.slice(0, Math.max(room - 1, 1))}…`;
}

export interface PlotScale {
  min: number;
  max: number;
}

export function scaleY(
  value: number,
  scale: PlotScale,
  height: number,
  pad: PlotPad = PLOT_PAD,
): number {
  const top = pad.top;
  const floor = height - pad.bottom;
  const range = scale.max - scale.min;
  if (range <= 0) return floor;
  const share = Math.min(1, Math.max(0, (value - scale.min) / range));
  return floor - share * (floor - top);
}

const BAR_RADIUS = 4;

/** Which end of a bar is the DATA end — the other one is the baseline and stays square. */
export type BarEnd = 'top' | 'right' | 'left';

interface BarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BAR_ENDS: Record<BarEnd, (box: BarBox, r: number) => string> = {
  top: ({ x, y, width, height }, r) =>
    `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`,
  right: ({ x, y, width, height }, r) =>
    `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} H${x} Z`,
  left: ({ x, y, width, height }, r) =>
    `M${x + width},${y} H${x + r} Q${x},${y} ${x},${y + r} V${y + height - r} Q${x},${y + height} ${x + r},${y + height} H${x + width} Z`,
};

/** 4px rounded at the data end, square at the baseline — the one bar shape here. */
export function barPath(box: BarBox, end: BarEnd): string {
  const radius = Math.max(0, Math.min(BAR_RADIUS, box.width / 2, box.height / 2));
  return BAR_ENDS[end](box, radius);
}
