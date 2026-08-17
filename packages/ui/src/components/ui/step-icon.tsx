import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface StepIconProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
}

/** The tinted glyph above a sign-in step. Decorative — the heading names the step. */
export function StepIcon({ icon: Icon, className, ...props }: Readonly<StepIconProps>) {
  return (
    <div
      className={cn(
        'mb-3 flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-primary/10',
        className,
      )}
      {...props}
    >
      <Icon className="size-5 text-primary" aria-hidden />
    </div>
  );
}
