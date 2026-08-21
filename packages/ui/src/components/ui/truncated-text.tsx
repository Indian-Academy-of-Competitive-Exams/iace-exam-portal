import * as React from 'react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/** Whether an element shows less than it holds, measured — so a short name gets no tooltip. */
export function useTruncation<T extends HTMLElement>(content: unknown) {
  const ref = React.useRef<T>(null);
  const [truncated, setTruncated] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // 1px slack absorbs sub-pixel layout at some zoom levels.
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  return { ref, truncated };
}

export interface TruncatedTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Shown inline, cut to the available width; revealed in full on hover. */
  children: string | null | undefined;
  /** Stands in for a value that is not there. Muted, because it is not content. */
  empty?: string;
}

/** One line, cut to fit, with a tooltip only when there is something to reveal. */
export function TruncatedText({
  children,
  className,
  empty = '—',
  ...props
}: Readonly<TruncatedTextProps>) {
  const { ref, truncated } = useTruncation<HTMLSpanElement>(children);

  // Nothing to cut and nothing to reveal, so no tooltip and no measuring cost.
  if (children === null || children === undefined || children === '') {
    return <span className="text-muted-foreground">{empty}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block truncate', className)} {...props}>
          {children}
        </span>
      </TooltipTrigger>
      {/* Rendered only when something is hidden — see `useTruncation`. */}
      {truncated ? <TooltipContent>{children}</TooltipContent> : null}
    </Tooltip>
  );
}
