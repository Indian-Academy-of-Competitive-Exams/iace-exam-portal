import * as React from 'react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * Reports whether an element is actually showing less than it holds.
 *
 * The point is that a tooltip should only exist where something is hidden. One
 * that fires on text the reader can already see is noise, and it trains them to
 * ignore the one that mattered. So this measures rather than assumes: `truncate`
 * on a short name changes nothing, and no tooltip appears.
 *
 * Re-measures on resize, because whether a name fits depends on the column
 * width, which depends on the window.
 */
export function useTruncation<T extends HTMLElement>(content: unknown) {
  const ref = React.useRef<T>(null);
  const [truncated, setTruncated] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // The 1px slack absorbs sub-pixel layout, which otherwise reports a
    // perfectly fitting string as overflowing on some zoom levels.
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
  children: string;
}

/** One line, cut to fit, with a tooltip only when there is something to reveal. */
export function TruncatedText({ children, className, ...props }: Readonly<TruncatedTextProps>) {
  const { ref, truncated } = useTruncation<HTMLSpanElement>(children);

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
