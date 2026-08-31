import * as React from 'react';
import { cn } from '../../lib/utils';

const TITLE_SIZE = { default: 'text-xl', display: 'text-2xl' } as const;

export type PageHeaderSize = keyof typeof TITLE_SIZE;

/** One page heading treatment. `meta` is a VALUE under the title; a screen never explains itself. */
export function PageHeader({
  title,
  meta,
  action,
  leading,
  breadcrumbs,
  size = 'default',
}: Readonly<{
  title: React.ReactNode;
  /** A value this record carries — a mobile, a version, a count. Never a sentence about the screen. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  /** Sits before the title — an avatar or an icon. Not a back button: that is the trail's job. */
  leading?: React.ReactNode;
  /** Above the title, full width — where this page sits and the way back out. */
  breadcrumbs?: React.ReactNode;
  /** `display` is for a landing or a result; every other page stays at `default`. */
  size?: PageHeaderSize;
}>) {
  return (
    <div className="mb-4">
      {breadcrumbs}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          {leading}
          <div>
            <h1 className={cn(TITLE_SIZE[size], 'font-semibold tracking-tight text-foreground')}>
              {title}
            </h1>
            {meta ? <p className="mt-1 text-sm text-muted-foreground">{meta}</p> : null}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
