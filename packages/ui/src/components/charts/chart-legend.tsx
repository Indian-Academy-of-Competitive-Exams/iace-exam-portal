import { cn } from '../../lib/utils';

/** Identity is never colour alone: two or more series always carry one of these. */
export interface ChartLegendItem {
  key: string;
  label: string;
  swatch: string;
  value?: string;
}

export interface ChartLegendProps {
  items: readonly ChartLegendItem[];
  className?: string;
}

export function ChartLegend({ items, className }: Readonly<ChartLegendProps>) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs">
          <span aria-hidden className={cn('size-2.5 shrink-0 rounded-sm', item.swatch)} />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value ? (
            <span className="font-medium tabular-nums text-foreground">{item.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
