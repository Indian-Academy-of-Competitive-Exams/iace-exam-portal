import * as React from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

export interface FieldProps {
  /** Must match the control's `id`, so clicking the label focuses the control. */
  htmlFor: string;
  label: React.ReactNode;
  /** Standing guidance — shown until an error replaces it. */
  hint?: React.ReactNode;
  error?: string;
  /** Receives the wiring it needs: aria-describedby, aria-invalid. */
  children: (control: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
  }) => React.ReactNode;
  className?: string;
}

/**
 * Label + control + hint/error, with `aria-describedby` wired.
 * The hint gives way to the error rather than stacking, so the height never changes.
 */
export function Field({ htmlFor, label, hint, error, children, className }: Readonly<FieldProps>) {
  const messageId = `${htmlFor}-message`;
  const hasMessage = Boolean(error ?? hint);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>

      {children({
        id: htmlFor,
        'aria-describedby': hasMessage ? messageId : undefined,
        'aria-invalid': error ? true : undefined,
      })}

      {hasMessage ? (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
