import { Info, TriangleAlert } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@iace/ui';

const TONE = {
  warning: 'animate-pulse bg-warning-subtle text-warning-ink motion-reduce:animate-none',
  info: 'bg-info-subtle text-info-ink',
} as const;

/** A notice that takes no room from the question: a glyph in the card's bar, its words a click away. */
export function NoticeChip({
  tone,
  label,
  children,
}: Readonly<{ tone: keyof typeof TONE; label: string; children: React.ReactNode }>) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger
            type="button"
            aria-label={label}
            className={cn(
              'flex size-6 flex-none items-center justify-center rounded-full focus-visible:shadow-focus focus-visible:outline-none [&_svg]:size-4',
              TONE[tone],
            )}
          >
            {tone === 'warning' ? <TriangleAlert aria-hidden /> : <Info aria-hidden />}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="max-w-sm p-3 text-sm">
        {children}
      </PopoverContent>
    </Popover>
  );
}
