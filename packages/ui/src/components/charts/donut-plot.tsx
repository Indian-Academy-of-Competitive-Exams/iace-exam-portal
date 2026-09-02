import { Pie, PieChart, Tooltip } from 'recharts';
import { cn } from '../../lib/utils';
import { CHART_VAR, TIP_WRAPPER } from './chart-theme';
import { ChartLegend } from './chart-legend';
import { PlotTip } from './chart-tooltip';
import { type CompositionSegment, type CompositionTone } from './composition-bar';

export interface DonutPlotProps {
  /** The same segments a `CompositionBar` takes: one partition, read two ways. */
  segments: readonly CompositionSegment[];
  /** The whole the slices partition, written in the hole. */
  centre?: { label: string; value: string };
  /** Pixels. */
  height?: number;
  'aria-label': string;
  className?: string;
}

const DEFAULT_HEIGHT = 240;
const RING_INNER = '62%';
const RING_OUTER = '88%';
/** A slice touching its neighbour reads as one; the surface between them is what separates. */
const SLICE_GAP = 2;

const FILL = {
  positive: CHART_VAR.success,
  negative: CHART_VAR.danger,
  neutral: CHART_VAR.muted,
} as const satisfies Record<CompositionTone, string>;

const SWATCH = {
  positive: 'bg-success',
  negative: 'bg-destructive',
  neutral: 'bg-muted-foreground',
} as const satisfies Record<CompositionTone, string>;

/** A partition with a hole: the ring carries the shares, the hole carries what they are shares OF. */
export function DonutPlot({
  segments,
  centre,
  height = DEFAULT_HEIGHT,
  className,
  ...props
}: Readonly<DonutPlotProps>) {
  // Recharts reads a slice's colour off the datum; `Cell` is deprecated and goes in v4.
  const drawn = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => ({ ...segment, fill: FILL[segment.tone ?? 'neutral'] }));

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative" role="img" aria-label={props['aria-label']} style={{ height }}>
        <PieChart responsive height={height} style={{ width: '100%', height }}>
          <Pie
            data={[...drawn]}
            dataKey="value"
            nameKey="label"
            innerRadius={RING_INNER}
            outerRadius={RING_OUTER}
            paddingAngle={SLICE_GAP}
            stroke="none"
            isAnimationActive={false}
          />

          <Tooltip
            isAnimationActive={false}
            wrapperStyle={TIP_WRAPPER}
            content={
              <PlotTip<CompositionSegment>
                title={(segment) => segment.label}
                rows={(segment) => [
                  {
                    key: segment.key,
                    value: textFor(segment),
                    swatch: SWATCH[segment.tone ?? 'neutral'],
                  },
                ]}
              />
            }
          />
        </PieChart>

        {centre ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {centre.value}
            </span>
            <span className="text-xs text-muted-foreground">{centre.label}</span>
          </div>
        ) : null}
      </div>

      <ChartLegend
        items={segments.map((segment) => ({
          key: segment.key,
          label: segment.label,
          value: textFor(segment),
          swatch: SWATCH[segment.tone ?? 'neutral'],
        }))}
      />
    </div>
  );
}

const textFor = (segment: CompositionSegment): string => segment.display ?? String(segment.value);
