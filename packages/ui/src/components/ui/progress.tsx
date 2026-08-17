import * as React from 'react';
import { cn } from '../../lib/utils';

const SIZES = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
} as const;

export type ProgressSize = keyof typeof SIZES;

export interface ProgressProps extends Omit<
  React.ProgressHTMLAttributes<HTMLProgressElement>,
  'value'
> {
  /**
   * How far along, out of `max`. Leave it out for work whose length is not
   * known — the bar then shows the browser's own indeterminate animation,
   * which is an honest "something is happening" rather than a made-up
   * percentage.
   */
  value?: number;
  max?: number;
  size?: ProgressSize;
  /** What is progressing. The bar is a picture and announces nothing alone. */
  'aria-label': string;
}

/**
 * How far along something is: an import reading rows, a section of a paper.
 *
 * The native `<progress>` element, for the same reason Checkbox uses a native
 * box — it already announces itself as a progress bar with its value, and it
 * already has an indeterminate state, both of which a div would have to earn
 * back with ARIA that is easy to get subtly wrong.
 *
 * Styling one means addressing three pseudo-elements: WebKit splits the track
 * and the fill into `::-webkit-progress-bar` and `::-webkit-progress-value`,
 * while Firefox styles the element itself as the track and `::-moz-progress-bar`
 * as the fill. Miss any of them and the bar is invisible in one browser and
 * fine in another — which is exactly the kind of difference nobody notices
 * until a student reports it.
 */
export const Progress = React.forwardRef<HTMLProgressElement, ProgressProps>(
  ({ className, value, max = 100, size = 'md', ...props }, ref) => (
    <progress
      ref={ref}
      value={value}
      max={max}
      className={cn(
        'w-full appearance-none overflow-hidden rounded-full',
        SIZES[size],
        // Firefox: the element is the track.
        'border-0 bg-muted',
        // WebKit: the track and the fill are separate pseudo-elements.
        '[&::-webkit-progress-bar]:bg-muted',
        '[&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary',
        '[&::-webkit-progress-value]:transition-[width]',
        '[&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary',
        className,
      )}
      {...props}
    />
  ),
);
Progress.displayName = 'Progress';
