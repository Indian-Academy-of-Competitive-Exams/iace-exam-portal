import * as React from 'react';
import type { FieldValues, SubmitHandler, UseFormReturn } from 'react-hook-form';
import { FILLS } from '../../lib/utils';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

export interface FormDialogProps<TValues extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<TValues>;
  onSubmit: SubmitHandler<TValues>;
  title: string;
  description?: React.ReactNode;
  /** Names the action, the way `ConfirmDialog` does — "Add student", never "Submit". */
  submitLabel: string;
  /** Mid-request: the submit button spins, Cancel goes inert, and neither Esc nor the ✕ dismisses it. */
  loading?: boolean;
  children: React.ReactNode;
}

/** One entity in a modal. Takes the whole `form` because closing has to reset it. */
export function FormDialog<TValues extends FieldValues>({
  open,
  onOpenChange,
  form,
  onSubmit,
  title,
  description,
  submitLabel,
  loading = false,
  children,
}: Readonly<FormDialogProps<TValues>>) {
  const change = (next: boolean) => {
    if (loading && !next) return;
    onOpenChange(next);
  };

  // Follows `open` itself: a parent that closes it on success never passes through `change`.
  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (wasOpen.current && !open) form.reset();
    wasOpen.current = open;
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent closeLabel={`Close ${title}`}>
        <form
          // A portal still bubbles React events, so without this the page's own form submits too.
          onSubmit={(event) => {
            event.stopPropagation();
            return form.handleSubmit(onSubmit)(event);
          }}
          noValidate
          className={FILLS}
        >
          <DialogHeader className="flex-col gap-1">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          {/* min-h-0 so the body is what shrinks; without it the flex child refuses to go
              below its content and the dialog grows past the viewport instead. */}
          <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 py-1">{children}</DialogBody>

          <DialogFooter>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => change(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
