import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/utils';

/** Arbitrary content beside its trigger; anything with menu semantics is a DropdownMenu. */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

// A dialog's scroll lock reads a portalled popover as outside it and cancels the scroll, so it never reaches the lock; a zoom gesture still does.
const keepOwnWheel = (event: React.WheelEvent) => {
  if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
};
const keepOwnTouch = (event: React.TouchEvent) => event.stopPropagation();

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      onWheel={keepOwnWheel}
      onTouchMove={keepOwnTouch}
      className={cn(
        // Portalled, to escape whatever clipped the trigger; above a dialog, since one opens inside one.
        'z-[--z-popover] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
