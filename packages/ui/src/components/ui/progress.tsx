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
  /** Omit for work of unknown length — the bar then runs the indeterminate animation. */
  value?: number;
  max?: number;
  size?: ProgressSize;
  /** What is progressing. The bar is a picture and announces nothing alone. */
  'aria-label': string;
}

/**
 * Native `<progress>`, which announces itself and has an indeterminate state.
 * Needs all three pseudo-elements: WebKit's bar and value, Firefox's bar.
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
