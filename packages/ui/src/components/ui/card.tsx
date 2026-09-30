import * as React from 'react';
import { cn } from '../../lib/utils';

/** Whether what is being drawn sits ON a card or straight on the page. */
const OnCardContext = React.createContext(false);

/** A table asks this to know if its heading has a surface under it or the page's own background. */
export function useOnCard(): boolean {
  return React.useContext(OnCardContext);
}

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    >
      <OnCardContext value={true}>{children}</OnCardContext>
    </div>
  ),
);
Card.displayName = 'Card';

export interface CardStepProps {
  title: React.ReactNode;
  /** A value the step carries — the number a code went to. Never a sentence about the step. */
  meta?: React.ReactNode;
  children: React.ReactNode;
}

/** One stage of a card that shows a stage at a time: a centred heading, then its form. */
function CardStep({ title, meta, children }: Readonly<CardStepProps>) {
  return (
    <>
      <div className="flex flex-col items-center gap-1.5 p-6 pt-4 text-center">
        <h3 className="text-lg font-semibold leading-none tracking-tight">{title}</h3>
        {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      <div className="p-6 pt-0">{children}</div>
    </>
  );
}

export { Card, CardStep };
