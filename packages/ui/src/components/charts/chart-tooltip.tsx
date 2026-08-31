import { cn } from '../../lib/utils';

/** Where a hovered or focused mark is, as a share of the plot box, and what it says. */
export interface ChartTip {
  x: number;
  y: number;
  title: string;
  rows: readonly ChartTipRow[];
}

export interface ChartTipRow {
  key: string;
  label?: string;
  value: string;
  /** A short stroke of the series colour; at this density a filled box is too much ink. */
  swatch?: string;
}

export interface ChartTooltipProps {
  tip: ChartTip | null;
}

const clamp = (share: number) => Math.min(0.94, Math.max(0.06, share));

/** The hover layer every plot here shares: the value leads, the label follows. */
export function ChartTooltip({ tip }: Readonly<ChartTooltipProps>) {
  if (!tip) return null;

  return (
    <div
      role="tooltip"
      style={{ left: `${clamp(tip.x) * 100}%`, top: `${clamp(tip.y) * 100}%` }}
      className={cn(
        'pointer-events-none absolute z-10 min-w-24 -translate-x-1/2 -translate-y-[calc(100%+10px)]',
        'rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md',
      )}
    >
      <p className="text-xs font-medium text-foreground">{tip.title}</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {tip.rows.map((row) => (
          <li key={row.key} className="flex items-center gap-1.5 text-xs">
            {row.swatch ? <span className={cn('h-0.5 w-3 rounded-full', row.swatch)} /> : null}
            <span className="font-semibold tabular-nums text-foreground">{row.value}</span>
            {row.label ? <span className="text-muted-foreground">{row.label}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
