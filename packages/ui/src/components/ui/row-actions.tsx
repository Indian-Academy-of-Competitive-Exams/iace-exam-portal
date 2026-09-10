import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';

export interface RowActionsProps {
  /** Names the trigger for a screen reader, since the glyph says nothing. */
  label?: string;
  /** `DropdownMenuItem`s. A destructive one takes `destructive`. */
  children: React.ReactNode;
  className?: string;
}

/** Everything a row can do, behind one trigger — a button per action is width off every row. */
export function RowActions({
  label = 'Row actions',
  children,
  className,
}: Readonly<RowActionsProps>) {
  // A trigger opening on nothing is a promise the row cannot keep; callers filter items inline.
  if (React.Children.toArray(children).length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={label}
          // A ring repeats down the last column, so this one control fills instead.
          className={cn('focus-visible:bg-muted focus-visible:shadow-none', className)}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      {/* Aligned to the row's end, which is where the trigger sits in the last column. */}
      <DropdownMenuContent align="end" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
