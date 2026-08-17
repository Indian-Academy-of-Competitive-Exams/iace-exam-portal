import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface StepIconProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
}

/**
 * The tinted glyph at the top of a sign-in step: enter your mobile, enter the
 * code, set a PIN.
 *
 * Decorative — the heading under it says what the step is, and a screen reader
 * that also announced the icon would hear the step twice. It exists to give a
 * single-field screen something to look at and to mark one step as different
 * from the last.
 *
 * Shared because both apps' login flows drew it, byte for byte: the brand tint,
 * the faint ring, the size. Two copies of a brand treatment is two places for
 * it to drift, and nobody compares two login screens side by side.
 */
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
