import * as React from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

/** Everything a control needs to be labelled, described and marked invalid. */
export type FieldControl = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
};

export interface FieldProps {
  /** Must match the control's `id`, so clicking the label focuses the control. */
  htmlFor: string;
  label: React.ReactNode;
  /** Standing guidance — shown until an error replaces it. */
  hint?: React.ReactNode;
  error?: string;
  children: (control: FieldControl) => React.ReactNode;
  className?: string;
}

/** Label + control + hint/error, with `aria-describedby` wired. The hint gives way to the error rather than stacking, so the height never changes. */
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

/** A value the form cannot change, drawn like the fields beside it rather than as a table row. */
export function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="flex h-9 items-center text-sm text-muted-foreground">{value}</span>
    </div>
  );
}

/** Two fields read as one row and stack when there is no width for both. Three is a section. */
export function FieldRow({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}
