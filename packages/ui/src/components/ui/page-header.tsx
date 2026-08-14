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
  leading,
}: Readonly<{
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /**
   * Sits before the title — an avatar, an icon, a back button.
   *
   * It exists because the student dashboard needed one and, lacking a slot for
   * it, hand-rolled the whole header instead: a different heading size, a
   * different gap. One screen opening differently from the other ten is not a
   * decision anybody made, it is what happens when the shared component cannot
   * express what a page needs. So the slot is the fix, not a copy.
   */
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
