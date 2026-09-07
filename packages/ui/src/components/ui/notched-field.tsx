import * as React from 'react';
import { cn } from '../../lib/utils';

export interface NotchedFieldProps {
  /** Must match the control's `id`, so clicking the name focuses the control. */
  htmlFor: string;
  label: string;
  children: (control: { id: string }) => React.ReactNode;
  className?: string;
}

/** Names a control from inside its top border, so a bar of them stays one row high. */
export function NotchedField({ htmlFor, label, children, className }: Readonly<NotchedFieldProps>) {
  return (
    <div className={cn('relative', className)}>
      {children({ id: htmlFor })}

      <label
        htmlFor={htmlFor}
        // Masks the border it sits on, painting whatever surface the bar was put on.
        className="pointer-events-none absolute -top-2 left-2 max-w-[calc(100%-1rem)] truncate bg-card px-1 text-xs text-muted-foreground"
      >
        {label}
      </label>
    </div>
  );
}
