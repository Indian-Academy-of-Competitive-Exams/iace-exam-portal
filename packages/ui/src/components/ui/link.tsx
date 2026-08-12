import { cva, type VariantProps } from 'class-variance-authority';

/**
 * How a link looks, chosen by the job it is doing.
 *
 * `record` — a table cell that opens that row's own page. No underline: a
 * column of them reads as a wall of rules and buries the data the table exists
 * to show. The cell is large, obviously a name, and sits where every row's link
 * sits, so hover colour is affordance enough.
 *
 * `inline` — a link inside a sentence. It KEEPS its underline. In running prose
 * there is nothing to mark it out except the styling, and colour alone is not a
 * signal every reader can see.
 *
 * The variants exist so the difference is a decision made once here, rather
 * than whichever class list got copied into the next table.
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
