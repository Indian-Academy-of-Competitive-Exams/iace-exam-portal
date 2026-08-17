import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

/**
 * Sections of one screen, one at a time — the Score Card beside the Solution
 * Report, the three steps of building a test.
 *
 * Unlike a checkbox or a radio there is no native element for this, so the
 * whole pattern is ARIA: `role="tablist"`, arrow keys between tabs, the panel
 * wired to the tab that owns it, and only the active tab in the page's tab
 * order so Tab moves INTO the panel rather than across the other tabs. Radix
 * owns all of it. Hand-built tabs are a row of buttons that swap a div, which
 * looks identical and announces nothing.
 *
 * Not for wizard steps that must be completed in order — a tab says "these are
 * alternatives, pick one", and a reader who can click step 3 first will.
 */
const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // A rule under the whole row, with the active tab sitting on it — the
      // underline says which section the content below belongs to. A pill
      // group would float free of the panel it labels.
      'flex items-center gap-1 border-b border-border',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px inline-flex items-center gap-2 whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
      'border-b-2 border-transparent text-muted-foreground',
      'hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none',
      // Colour AND a border: the active tab must still be identifiable to
      // someone who cannot tell the two text colours apart.
      'data-[state=active]:border-primary data-[state=active]:text-foreground',
      'disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('pt-4 focus-visible:shadow-focus focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
