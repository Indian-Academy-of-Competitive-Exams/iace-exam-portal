import * as React from 'react';
import { cn } from '../../lib/utils';
import { Card } from './card';

export interface FormPanelProps {
  /** Pinned above the card — a `PageHeader` and its trail. */
  header?: React.ReactNode;
  /** Pinned inside the card, below the scroll — the form's own Save and Cancel. */
  footer?: React.ReactNode;
  /** Makes the card a real `<form>`, so Enter submits and the footer button can be `type="submit"`. */
  onSubmit?: NonNullable<React.FormHTMLAttributes<HTMLFormElement>['onSubmit']>;
  children: React.ReactNode;
  className?: string;
}

const BODY = 'flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6';

/** A page that is ONE thing. Replaces `PageFrame`; nesting the two would be two scrollports. */
export function FormPanel({
  header,
  footer,
  onSubmit,
  children,
  className,
}: Readonly<FormPanelProps>) {
  const body = <div className={cn(BODY, className)}>{children}</div>;
  const foot = footer ? (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
      {footer}
    </div>
  ) : null;

  return (
    <div data-page-frame className="flex min-h-0 flex-1 flex-col">
      {header ? <div className="shrink-0">{header}</div> : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {onSubmit ? (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            {body}
            {foot}
          </form>
        ) : (
          <>
            {body}
            {foot}
          </>
        )}
      </Card>
    </div>
  );
}

export interface FormSectionProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** One group inside the panel. A heading and spacing, never a border — see the card rule. */
export function FormSection({
  title,
  description,
  children,
  className,
}: Readonly<FormSectionProps>) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
