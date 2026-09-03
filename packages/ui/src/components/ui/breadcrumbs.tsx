import * as React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface BreadcrumbItem {
  label: string;
  /** Absent for a step that groups screens without being one. */
  to?: string;
}

export interface BreadcrumbsProps {
  /** Ancestors first, the current page last. Fewer than two renders nothing. */
  items: readonly BreadcrumbItem[];
  /** Router-agnostic: the app passes its own Link so this package stays free of one. */
  renderLink: (to: string, children: React.ReactNode, className: string) => React.ReactNode;
  className?: string;
}

const LINK = [
  'rounded-sm underline-offset-4 hover:text-foreground hover:underline',
  'focus-visible:shadow-focus focus-visible:outline-none',
].join(' ');

/** The nearest ancestor that can actually be navigated to. */
function parentOf(items: readonly BreadcrumbItem[]): (BreadcrumbItem & { to: string }) | undefined {
  // slice already copies, so reversing in place is not reversing the caller's array.
  return items
    .slice(0, -1)
    .reverse()
    .find((item): item is BreadcrumbItem & { to: string } => item.to !== undefined);
}

/** The full trail from `sm` up; below it the parent alone, since a wrapped trail costs rows. */
export function Breadcrumbs({ items, renderLink, className }: Readonly<BreadcrumbsProps>) {
  // One crumb is the page you are on, which the title already says.
  if (items.length < 2) return null;

  const parent = parentOf(items);

  return (
    <nav aria-label="Breadcrumb" className={cn('mb-2 text-sm text-muted-foreground', className)}>
      {parent ? (
        <span className="flex items-center gap-1.5 sm:hidden">
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          {renderLink(parent.to, parent.label, LINK)}
        </span>
      ) : null}

      <ol className="hidden flex-wrap items-center gap-1.5 sm:flex">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${item.to ?? index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
              ) : null}
              {/* A self-link is stripped by the caller, which is the layer that knows where it is. */}
              {item.to === undefined ? (
                <span
                  className={cn(last && 'font-medium text-foreground')}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                renderLink(item.to, item.label, cn(LINK, last && 'font-medium text-foreground'))
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
