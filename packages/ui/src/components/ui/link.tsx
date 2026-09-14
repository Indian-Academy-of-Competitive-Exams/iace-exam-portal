const VARIANTS = {
  /** A table cell opening that row's page, no underline. */
  record: 'font-medium text-foreground hover:text-primary',
  /** A link inside prose, which keeps its underline. */
  inline: 'underline underline-offset-4 hover:text-primary',
} as const;

export const linkVariants = ({ variant = 'record' }: { variant?: keyof typeof VARIANTS } = {}) =>
  `rounded-sm transition-colors focus-visible:shadow-focus focus-visible:outline-none ${VARIANTS[variant]}`;
