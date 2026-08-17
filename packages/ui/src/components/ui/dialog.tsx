import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

/**
 * The modal layer.
 *
 * Built on Radix because the hard parts of a dialog are the invisible ones:
 * focus moves into it and cannot leave while it is open, Escape closes it,
 * everything behind it is inert to a screen reader, and focus returns to
 * whatever opened it. An untrapped modal is worse than no modal — the reader
 * tabs into a page they cannot see and lands on controls that do nothing.
 *
 * It replaces the raw `.overlay` / `.modal` classes that used to live in
 * components.css. Two definitions of one component is one definition too many,
 * and the one nobody renders is the one that rots.
 *
 * Every value here comes from the same tokens that CSS used: --overlay-bg,
 * --modal-w-*, --modal-radius, --modal-pad, --shadow-overlay and the z-index
 * scale, so light and dark still swap in one place.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-[--z-overlay] bg-[--overlay-bg] animate-overlay-in', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const dialogVariants = cva(
  [
    // pointer-events restored here because the centring wrapper waives them, so
    // a click beside the dialog reaches the overlay and dismisses.
    'pointer-events-auto relative flex w-full flex-col',
    'max-h-[calc(100dvh-4rem)]',
    'bg-surface text-foreground rounded-[--modal-radius] shadow-[--shadow-overlay]',
    'animate-dialog-in focus:outline-none',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'max-w-[--modal-w-sm]',
        md: 'max-w-[--modal-w-md]',
        lg: 'max-w-[--modal-w-lg]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface DialogContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogVariants> {
  /** The corner ✕. Off for a confirm, where Cancel is already the way out. */
  showClose?: boolean;
  /** Accessible name for the ✕, since the icon alone announces nothing. */
  closeLabel?: string;
}

/**
 * Always render a `DialogTitle` inside this — Radix labels the dialog with it,
 * and without one a screen reader announces an unnamed region.
 */
const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, showClose = true, closeLabel = 'Close', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    {/* The dialog is centred by this wrapper rather than by a transform of its
        own, so the entry animation can end at `transform: none` without
        knocking it off centre. The wrapper scrolls when a tall dialog meets a
        short window — the page behind is already locked by Radix. */}
    <div className="pointer-events-none fixed inset-0 z-[--z-modal] grid place-items-center overflow-y-auto p-4">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(dialogVariants({ size }), className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            aria-label={closeLabel}
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </div>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** Padded on the right whether or not the ✕ is there, so a long title wraps in
 *  the same place either way rather than reflowing when the prop changes. */
function DialogHeader({ className, ...props }: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-[--modal-pad] pb-3 pr-12 pt-[--modal-pad]',
        className,
      )}
      {...props}
    />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('flex-1 text-lg font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-normal text-foreground-secondary', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

/** The scrolling middle. Header and footer stay put; only this moves. */
function DialogBody({ className, ...props }: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn(
        'overflow-y-auto px-[--modal-pad] text-sm leading-normal text-foreground-secondary',
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: Readonly<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 px-[--modal-pad] pb-[--modal-pad] pt-5',
        className,
      )}
      {...props}
    />
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the action does and what it does not undo. */
  description: React.ReactNode;
  /**
   * Names the action — "Deactivate", "Delete test". Never "Confirm" or "OK":
   * a reader who skipped the sentence learns nothing from a button that only
   * agrees with a question they did not read.
   */
  confirmLabel: string;
  cancelLabel?: string;
  /** Crimson button, warning glyph — for anything that destroys or revokes. */
  destructive?: boolean;
  /** Keeps the dialog open and inert while the action it started is running. */
  loading?: boolean;
  onConfirm: () => void;
  /** Extra detail between the description and the buttons. */
  children?: React.ReactNode;
}

/**
 * "Are you sure?" done once, properly.
 *
 * It replaces `globalThis.confirm`, which cannot be themed, cannot be tested,
 * cannot say which thing it is about in anything but plain text, and blocks the
 * whole browser tab while it is up.
 *
 * Two rules are built in rather than left to each call site:
 *
 *   · Cancel takes the focus, never the destructive button. Enter on a dialog
 *     that appeared under the reader's fingers must not delete anything.
 *   · Cancel is neutral grey. Only the action itself is crimson, so the colour
 *     means "this is the one that destroys" rather than "this is a dialog".
 *
 * It does NOT close itself. The caller closes it when the work it started has
 * finished, because closing on click hides the failure: the row would still be
 * there, unchanged, with nothing on screen tying the toast to the thing it
 * refused to do.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  children,
}: Readonly<ConfirmDialogProps>) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // While the action runs, the only way out is for it to finish. Escape and a
  // click outside would otherwise dismiss a dialog whose work is still in
  // flight, leaving the reader to guess whether it went through.
  const blockWhileLoading = (event: Event) => {
    if (loading) event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        showClose={false}
        onEscapeKeyDown={blockWhileLoading}
        onPointerDownOutside={blockWhileLoading}
        onInteractOutside={blockWhileLoading}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogHeader className="pr-[--modal-pad]">
          {destructive ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/12 text-destructive">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
          ) : null}
          <div className="flex flex-1 flex-col gap-2">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </DialogHeader>

        {children ? <DialogBody>{children}</DialogBody> : null}

        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  ConfirmDialog,
  dialogVariants,
};
