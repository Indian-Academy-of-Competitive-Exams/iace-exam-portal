import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

/**
 * A tooltip for text the layout had to cut short.
 *
 * It is for RECOVERING hidden content, never for carrying information that
 * exists nowhere else — it does not survive touch, print, or a screen reader
 * that never hovers. Anything a decision depends on belongs on the page.
 *
 * `TooltipProvider` goes once, high in the app. It owns the shared open delay,
 * which is what stops a row of them flickering as the pointer crosses a table,
 * and it carries the tuning below so no app has to restate it — two app roots
 * with slightly different tooltip timing is a difference nobody chose.
 */
function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 200,
  /**
   * Ours only ever hold text. Radix otherwise keeps a grace area alive between
   * trigger and content so a pointer can travel into it, and while it believes
   * the pointer is in transit the NEXT trigger will not open — moving from a
   * truncated name to the "+N" beside it showed nothing at all.
   */
  disableHoverableContent = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) {
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
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Portalled, so it escapes the table cell that clipped the text in the
        // first place. max-w keeps a long name to a readable measure instead of
        // one line the width of the screen.
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
