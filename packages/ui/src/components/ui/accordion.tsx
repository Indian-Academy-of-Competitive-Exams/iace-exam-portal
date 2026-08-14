import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface AccordionProps extends Omit<React.HTMLAttributes<HTMLDetailsElement>, 'title'> {
  /** The always-visible row. Clicking it toggles the panel. */
  title: React.ReactNode;
  /** Sits at the right of the summary row — a count, a badge, a status. */
  meta?: React.ReactNode;
  /** Open on first render. Uncontrolled after that: the reader owns it. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A disclosure panel, on native `<details>`/`<summary>`.
 *
 * Native because the browser already gives this one keyboard operation, the
 * right role, correct announcement of expanded/collapsed, and — the part that
 * is easy to forget — in-page find that can reveal a match inside a closed
 * panel. A div-and-onClick version has to re-earn all four, and usually earns
 * the first three and forgets the fourth.
 *
 * Uncontrolled on purpose. `defaultOpen` sets the initial state and then the
 * reader owns it; a controlled panel that re-closes itself on every refetch is
 * the standard way this component goes wrong.
 */
const Accordion = React.forwardRef<HTMLDetailsElement, AccordionProps>(
  ({ className, title, meta, defaultOpen = false, children, ...props }, ref) => (
    <details
      ref={ref}
      open={defaultOpen}
      className={cn('group rounded-lg border border-border bg-surface', className)}
      {...props}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3',
          'hover:bg-muted/50 focus-visible:shadow-focus focus-visible:outline-none',
          // Safari draws its own triangle and ignores list-style.
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        <div className="min-w-0 flex-1">{title}</div>
        {meta}
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  ),
);
Accordion.displayName = 'Accordion';

export { Accordion };
