import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Variants map 1:1 onto the semantic roles in tokens.css — no raw values here.
 *   default     brand red (#B83939) — primary/brand actions only
 *   secondary   neutral grey — this is what Cancel uses, never red
 *   destructive crimson — delete / reject, always with a confirm
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover',
        outline:
          'border border-border bg-surface text-foreground shadow-sm hover:bg-muted hover:text-foreground',
        ghost: 'text-foreground hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-10 px-4 py-2',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10',
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
  /**
   * The leading glyph. A prop rather than a child because `loading` swaps it
   * for the spinner — the icon and the spinner are the same slot, and a button
   * showing both says the action is running twice.
   */
  icon?: React.ReactNode;
  /**
   * The action this button started has not come back yet.
   *
   * Disables as well as spins: the whole point is that a second click cannot
   * land, and `disabled` is the only thing that actually stops one. `aria-busy`
   * says the same to a screen reader, which sees no spinner.
   */
  loading?: boolean;
}

/**
 * `loading` is a prop, not a pattern each screen re-types.
 *
 * It was `{m.isPending ? <Loader2 className="animate-spin" /> : <Icon />}` in a
 * dozen places, which is a design decision (which spinner, what size, does the
 * button disable, does anything announce it) copied by hand a dozen times — and
 * the copies had already drifted: some disabled the button, some did not, none
 * set aria-busy, so a screen reader was told nothing was happening at all.
 */
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
      // A bare <button> in a form submits it. Every button we have that means
      // to submit says so; the other forty do not, and one of them landing
      // inside a form later would post it on a click meant to open a panel —
      // which looks like a bug in the form, not in the button. Not applied to
      // the asChild branch: `type` on an <a> is a MIME hint, not a role.
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);

    // asChild hands rendering to the child element, which owns its own content
    // — injecting a spinner into it would put a second child inside a Slot that
    // accepts exactly one. A link does not have a pending state anyway.
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
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
