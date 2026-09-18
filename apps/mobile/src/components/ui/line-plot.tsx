/**
 * The web's LinePlot on a phone, drawn with react-native-svg instead of
 * recharts: the same points, band and reference, and the same rule that a null
 * is nothing to plot rather than zero. There is no tooltip — a touch has no
 * hover, so the last measured point wears its reading instead.
 */
/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Text as Label, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { plotRuns, type TrendPoint } from '../../lib/trend';
import { useTokenColor } from '../../lib/use-token-color';

const UNMEASURED = '—';
const HEIGHT = 180;
const PAD = { top: 16, right: 12, bottom: 8, left: 28 };
const DOT = 3.5;

export interface LinePoint extends TrendPoint {
  display?: string;
}

/** A shaded y-range the line is read against, such as where the top of the cohort sits. */
export interface PlotBand {
  from: number;
  to: number;
  label: string;
}

export interface PlotReference {
  value: number;
  label: string;
}

export interface LinePlotProps {
  points: readonly LinePoint[];
  min?: number;
  max?: number;
  suffix?: string;
  ticks?: readonly number[];
  band?: PlotBand;
  reference?: PlotReference;
  label: string;
}

export function LinePlot({
  points,
  min = 0,
  max = 100,
  suffix = '',
  ticks = [0, 50, 100],
  band,
  reference,
  label,
}: Readonly<LinePlotProps>) {
  const [width, setWidth] = useState(0);
  const line = useTokenColor('--series-1');
  const grid = useTokenColor('--chart-grid');
  const axis = useTokenColor('--chart-axis');
  const surface = useTokenColor('--surface');
  const ink = useTokenColor('--chart-ink');
  const muted = useTokenColor('--muted');

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const plot = { width: width - PAD.left - PAD.right, height: HEIGHT - PAD.top - PAD.bottom };

  const x = (index: number) =>
    PAD.left + (points.length < 2 ? plot.width / 2 : (index / (points.length - 1)) * plot.width);
  const y = (value: number) =>
    PAD.top + plot.height - ((clamp(value, min, max) - min) / (max - min)) * plot.height;

  const last = lastMeasured(points);

  return (
    <View onLayout={onLayout} accessibilityRole="image" accessibilityLabel={label}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {band ? (
            <Rect
              x={PAD.left}
              y={y(band.to)}
              width={plot.width}
              height={Math.max(y(band.from) - y(band.to), 0)}
              fill={muted}
              opacity={0.35}
            />
          ) : null}

          {ticks.map((tick) => (
            <Line
              key={tick}
              x1={PAD.left}
              x2={PAD.left + plot.width}
              y1={y(tick)}
              y2={y(tick)}
              stroke={grid}
              strokeWidth={1}
            />
          ))}
          {ticks.map((tick) => (
            <SvgText key={`n${tick}`} x={4} y={y(tick) + 4} fontSize={10} fill={axis}>
              {String(tick)}
            </SvgText>
          ))}

          {reference ? (
            <>
              <Line
                x1={PAD.left}
                x2={PAD.left + plot.width}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke={axis}
                strokeWidth={1}
                strokeDasharray="6 4"
              />
              <SvgText
                x={PAD.left + plot.width}
                y={y(reference.value) - 5}
                fontSize={10}
                fill={axis}
                textAnchor="end"
              >
                {reference.label}
              </SvgText>
            </>
          ) : null}

          {plotRuns(points).map((run) => (
            <Path
              key={points[run[0] ?? 0]?.key}
              d={run
                .map((index, step) => segment(step, x(index), y(valueAt(points, index))))
                .join(' ')}
              stroke={line}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}

          {points.map((point, index) =>
            point.value === null ? null : (
              <Circle
                key={point.key}
                cx={x(index)}
                cy={y(point.value)}
                r={point.key === last?.point.key ? DOT + 1.5 : DOT}
                fill={line}
                stroke={surface}
                strokeWidth={2}
              />
            ),
          )}

          {last ? (
            <SvgText
              x={x(last.index) - 8}
              y={Math.max(y(valueAt(points, last.index)) - 10, 12)}
              fontSize={12}
              fontWeight="600"
              fill={ink}
              textAnchor="end"
            >
              {textOf(last.point, suffix)}
            </SvgText>
          ) : null}
        </Svg>
      ) : (
        <View style={{ height: HEIGHT }} />
      )}

      {band ? <Label className="text-2xs text-muted-foreground">{band.label}</Label> : null}
    </View>
  );
}

const segment = (step: number, at: number, height: number) =>
  `${step === 0 ? 'M' : 'L'}${at.toFixed(1)} ${height.toFixed(1)}`;

const valueAt = (points: readonly LinePoint[], index: number) => points[index]?.value ?? 0;

function lastMeasured(points: readonly LinePoint[]): { point: LinePoint; index: number } | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && point.value !== null) return { point, index };
  }
  return null;
}

/** Unmeasured reads as a dash. Coercing it to 0 would claim the student scored nothing. */
function textOf(point: LinePoint, suffix: string): string {
  if (point.display !== undefined) return point.display;
  return point.value === null ? UNMEASURED : `${point.value}${suffix}`;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
