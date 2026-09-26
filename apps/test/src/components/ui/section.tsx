import * as React from 'react';
import { SectionHeading, cn } from '@iace/ui';

export interface SectionProps {
  /** The plain noun for the region below. */
  title: string;
  /** A value the region carries — a count, a name. Never a sentence. */
  meta?: React.ReactNode;
  /** The way deeper into what this names — a link, never a second heading. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** A page tour's anchor for this region, landing as `data-tour`. */
  tour?: string;
}

/** A named block on a student screen: the heading, then its content at `--gap-group`. */
export function Section({
  title,
  meta,
  action,
  children,
  className,
  tour,
}: Readonly<SectionProps>) {
  return (
    <section data-tour={tour} className={cn('flex min-w-0 flex-col gap-4', className)}>
      <SectionHeading title={title} meta={meta} action={action} />
      {children}
    </section>
  );
}
