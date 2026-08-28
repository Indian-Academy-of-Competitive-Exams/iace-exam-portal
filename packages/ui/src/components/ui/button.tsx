import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/** A filled control reads as off by going grey, not by fading — half-opacity on a pale card is still pale. */
const OFF = 'disabled:bg-disabled disabled:text-disabled-foreground';

/** default = brand red, secondary = neutral grey (what Cancel uses), destructive = crimson. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: ['bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover', OFF],
        secondary: ['bg-secondary text-secondary-foreground hover:bg-secondary-hover', OFF],
        destructive: [
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover',
          OFF,
        ],
        outline: [
          'border border-border bg-surface text-foreground shadow-sm hover:bg-muted hover:text-foreground',
          OFF,
          'disabled:border-disabled-border',
        ],
        // No fill to mute, so these take the ink alone.
        ghost: 'text-foreground hover:bg-muted disabled:text-disabled-foreground',
        link: 'text-primary underline-offset-4 hover:underline disabled:text-disabled-foreground disabled:no-underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-10 px-4 py-2',
        lg: 'h-11 px-6',
        // Round: the target IS the glyph, so its corners would belong to nothing.
        icon: 'size-10 rounded-full',
        iconSm: 'size-8 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a router <Link>) instead of a <button>. */
  asChild?: boolean;
  /** Leading glyph. `loading` swaps it for the spinner — one slot, never both. */
  icon?: React.ReactNode;
  /** Spins, disables, and sets `aria-busy`. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      icon,
      loading = false,
      disabled,
      children,
      // A bare <button> submits its form. Not for asChild: `type` on an <a> is a MIME hint.
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);

    // Slot takes exactly one child, so nothing is injected here.
    if (asChild) {
      return (
        <Slot className={classes} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        type={type}
        className={classes}
        ref={ref}
        disabled={Boolean(disabled) || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* eslint-disable-next-line no-restricted-syntax -- a Button's own loading state is the sanctioned action spinner. */}
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
