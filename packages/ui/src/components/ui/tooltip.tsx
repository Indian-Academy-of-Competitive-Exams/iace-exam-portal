import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

/**
 * For recovering text the layout cut short, never a value's only home.
 * `TooltipProvider` goes once, high in the app, and owns the shared delay.
 */
function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 200,
  /** Ours hold text only; the grace area otherwise blocks the next trigger from opening. */
  disableHoverableContent = true,
  ...props
}: Readonly<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      disableHoverableContent={disableHoverableContent}
      {...props}
    />
  );
}
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Portalled, to escape the cell that clipped the text. max-w keeps a readable measure.
        'z-50 max-w-xs whitespace-pre-line break-words rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md',
        'animate-tooltip-in',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
