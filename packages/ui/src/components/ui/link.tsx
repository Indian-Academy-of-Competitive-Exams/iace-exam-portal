import { cva, type VariantProps } from 'class-variance-authority';

/**
 * `record` — a table cell opening that row's page, no underline.
 * `inline` — a link inside prose, which keeps its underline.
 */
export const linkVariants = cva(
  'rounded-sm transition-colors focus-visible:shadow-focus focus-visible:outline-none',
  {
    variants: {
      variant: {
        record: 'font-medium text-foreground hover:text-primary',
        inline: 'underline underline-offset-4 hover:text-primary',
      },
    },
    defaultVariants: { variant: 'record' },
  },
);

export type LinkVariants = VariantProps<typeof linkVariants>;
