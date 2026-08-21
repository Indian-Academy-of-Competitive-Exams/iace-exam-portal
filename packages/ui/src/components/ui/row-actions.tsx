import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
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
  const trigger = React.useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu
      // On close, before an item's dialog mounts and records what to return focus to.
      onOpenChange={(open) => {
        if (!open) trigger.current?.focus();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="iconSm"
          aria-label={label}
          className={className}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      {/* Aligned to the row's end, which is where the trigger sits in the last column. */}
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        // Ours, not Radix's: its restore runs late enough for the dialog to miss it.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
