import * as React from 'react';

/** One page heading treatment. The description keeps a measure limit. */
export function PageHeader({
  title,
  description,
  action,
  leading,
}: Readonly<{
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Sits before the title — an avatar, an icon, a back button. */
  leading?: React.ReactNode;
}>) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
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
  );
}
