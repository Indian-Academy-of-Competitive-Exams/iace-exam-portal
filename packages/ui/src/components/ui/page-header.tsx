import * as React from 'react';

/**
 * One page heading treatment, so every screen opens the same way.
 *
 * It lived twice — once per app — and had already drifted: two heading sizes,
 * two gaps, and a measure limit on the description in one of them and not the
 * other. None of that was decided; it is just what happens to two copies.
 *
 * The description keeps its measure limit. A line of prose running the full
 * width of a 1600px admin screen is genuinely harder to read, and that is the
 * one part of this worth defending.
 */
export function PageHeader({
  title,
  description,
  action,
}: Readonly<{
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}>) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
