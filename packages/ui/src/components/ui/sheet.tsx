import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A panel that slides in from an edge: the mobile nav drawer, and — when the
 * exam engine arrives — the question palette on a phone.
 *
 * It is the dialog primitive wearing a different shape, and it is here for the
 * same reason: a hand-built drawer is an overlay and a panel, and everything
 * that makes it safe is invisible. Focus has to move into it and stay there
 * while it is open, Escape has to close it, the page behind has to stop
 * scrolling and go inert to a screen reader, and focus has to return to the
 * button that opened it. A drawer missing those is one the reader can tab
 * straight out of, into a page they cannot see.
 *
 * Always render a `SheetTitle` inside it. Where the panel has no visible
 * heading — a nav drawer under a logo — give it one and hide it with
 * `className="sr-only"`: it is what a screen reader announces on arrival, and
 * without it the panel is an unnamed region.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const sheetVariants = cva(
  [
    'fixed inset-y-0 z-[--z-drawer] flex w-[--drawer-w] max-w-[85vw] flex-col',
    'bg-surface p-[--sidebar-pad] shadow-[--shadow-overlay] focus:outline-none',
  ].join(' '),
  {
    variants: {
      side: {
        left: 'left-0 border-r border-border animate-sheet-in-left',
        right: 'right-0 border-l border-border animate-sheet-in-right',
      },
    },
    defaultVariants: { side: 'left' },
  },
);

export interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** The corner ✕. Off when the panel supplies its own close control. */
  showClose?: boolean;
  closeLabel?: string;
}

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side, showClose = true, closeLabel = 'Close', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[--z-drawer] bg-[--overlay-bg] animate-overlay-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogPrimitive.Close
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
          aria-label={closeLabel}
        >
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      ) : null}
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

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-normal text-foreground-secondary', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetDescription,
  sheetVariants,
};
