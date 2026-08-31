import { cn } from '../../lib/utils';
import { Card } from '../ui/card';
import { CompositionBar, type CompositionSegment } from './composition-bar';

export interface ComparisonItem {
  key: string;
  label: string;
  meta?: string;
  value: number;
  max: number;
  display?: string;
  segments: readonly CompositionSegment[];
  /** The counts behind the bar, so the shares are never the only reading. */
  caption: string;
  tone?: 'current' | 'good' | 'neutral';
}

export interface ComparisonCardsProps {
  items: readonly ComparisonItem[];
  className?: string;
}

const EDGE = {
  current: 'border-series-1',
  good: 'border-success',
  neutral: 'border-border',
} as const;

/** Sibling outcomes side by side — the one being read is the one with the edge. */
export function ComparisonCards({ items, className }: Readonly<ComparisonCardsProps>) {
  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((item) => (
        <li key={item.key}>
          <Card className={cn('h-full bg-chart-surface p-5', EDGE[item.tone ?? 'neutral'])}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {item.label}
              </span>
              {item.meta ? (
                <span className="text-xs text-muted-foreground">{item.meta}</span>
              ) : null}
            </div>

            <p className="mt-3 flex items-baseline leading-none">
              <span className="text-3xl font-bold text-foreground">
                {item.display ?? item.value}
              </span>
              <span className="text-base font-semibold text-muted-foreground">/{item.max}</span>
            </p>

            <CompositionBar
              className="mt-4"
              size="sm"
              segments={item.segments}
              aria-label={item.label}
            />

            <p className="mt-3 text-xs text-foreground-secondary">{item.caption}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
