import * as React from 'react';

/** One page heading treatment. The description keeps a measure limit. */
export function PageHeader({
  title,
  description,
  action,
  leading,
  breadcrumbs,
}: Readonly<{
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Sits before the title — an avatar or an icon. Not a back button: that is the trail's job. */
  leading?: React.ReactNode;
  /** Above the title, full width — where this page sits and the way back out. */
  breadcrumbs?: React.ReactNode;
}>) {
  return (
    <div className="mb-6">
      {breadcrumbs}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          {leading}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
