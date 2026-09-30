import * as React from 'react';
import { cn } from '@iace/ui';

/** The student rhythm: `--gap-section` between blocks, so no screen hand-picks its own spacing. */
export function PageBody({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return <div className={cn('flex flex-col gap-10', className)}>{children}</div>;
}
