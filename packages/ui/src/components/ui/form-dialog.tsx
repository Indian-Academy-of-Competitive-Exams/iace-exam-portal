import * as React from 'react';
import type { FieldValues, SubmitHandler, UseFormReturn } from 'react-hook-form';
import { cn } from '../../lib/utils';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogContentProps,
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
  cancelLabel?: string;
  /** Mid-request: the submit button spins and both buttons go inert. */
  loading?: boolean;
  size?: NonNullable<DialogContentProps['size']>;
  children: React.ReactNode;
  className?: string;
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
  cancelLabel = 'Cancel',
  loading = false,
  size,
  children,
  className,
}: Readonly<FormDialogProps<TValues>>) {
  const change = (next: boolean) => {
    if (!next) form.reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent size={size} closeLabel={`Close ${title}`}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="flex-col gap-1">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          {/* min-h-0 so the body is what shrinks; without it the flex child refuses to go
              below its content and the dialog grows past the viewport instead. */}
          <DialogBody className={cn('flex min-h-0 flex-1 flex-col gap-4 py-1', className)}>
            {children}
          </DialogBody>

          <DialogFooter>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => change(false)}
            >
              {cancelLabel}
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
