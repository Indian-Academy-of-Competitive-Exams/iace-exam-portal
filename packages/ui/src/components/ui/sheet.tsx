import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';

/**
 * A panel sliding in from an edge, on the dialog primitive: focus trap, Escape, scroll lock.
 * Always render a `SheetTitle`; hide it with `sr-only` where there is no visible heading.
 */
const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[--z-drawer] bg-[--overlay-bg] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 left-0 z-[--z-drawer] flex w-[--drawer-w] max-w-[85vw] flex-col border-r border-border',
        'bg-surface p-[--sidebar-pad] shadow-[--shadow-overlay] focus:outline-none',
        'data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export { Sheet, SheetClose, SheetContent, SheetTitle };
