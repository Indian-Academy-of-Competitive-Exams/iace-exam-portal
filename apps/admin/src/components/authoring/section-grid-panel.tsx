import { useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@iace/ui';
import { type WindowPosition } from './questions-window';

/** The section's questions as numbered tiles beside the window; folded, a rail that still says where you are. */
export function SectionGridPanel({
  keys,
  position,
  footer,
}: Readonly<{
  keys: readonly string[];
  position: WindowPosition;
  /** Under the tiles: what belongs to the section rather than to one question, such as its thread. */
  footer?: React.ReactNode;
}>) {
  const [open, setOpen] = useState(true);
  const place = `${Math.min(position.active + 1, keys.length)}/${keys.length}`;

  if (!open) {
    return (
      <aside className="flex w-12 flex-none flex-col items-center gap-2 border-l border-border py-3">
        <FoldButton label="Show the question grid" onClick={() => setOpen(true)}>
          <PanelRightOpen aria-hidden />
        </FoldButton>
        <span className="text-xs tabular-nums text-muted-foreground">{place}</span>
      </aside>
    );
  }

  return (
    <aside className="flex w-60 flex-none flex-col gap-3 border-l border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Questions</h2>
        <FoldButton label="Hide the question grid" onClick={() => setOpen(false)}>
          <PanelRightClose aria-hidden />
        </FoldButton>
      </div>

      <ol className="grid grid-cols-5 gap-1.5">
        {keys.map((key, index) => (
          <li key={key}>
            <button
              type="button"
              aria-label={`Question ${index + 1}`}
              aria-current={index === position.active ? 'true' : undefined}
              onClick={() => position.jump(key)}
              className={cn(
                'h-8 w-full rounded-md border border-border text-xs tabular-nums transition-colors hover:bg-muted',
                'focus-visible:shadow-focus focus-visible:outline-none',
                index === position.active && 'border-primary bg-primary/10 font-semibold',
              )}
            >
              {index + 1}
            </button>
          </li>
        ))}
      </ol>

      {footer}
    </aside>
  );
}

function FoldButton({
  label,
  onClick,
  children,
}: Readonly<{ label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
