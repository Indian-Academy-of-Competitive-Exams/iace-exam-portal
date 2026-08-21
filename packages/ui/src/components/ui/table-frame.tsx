import * as React from 'react';
import { Card } from './card';
import { cn } from '../../lib/utils';

/**
 * The app shell's content wrapper. Here rather than in the shell so this and the
 * `data-page-frame` below cannot drift apart. Unsupported `:has()` just scrolls.
 */
export const PAGE_CONTENT_CLASS = [
  // Unconditional: a framed page is a flex child, so it shortens to fit the padding.
  'mx-auto w-full flex-1 overflow-y-auto px-5 py-6',
  'has-[[data-page-frame]]:flex has-[[data-page-frame]]:flex-col',
  'has-[[data-page-frame]]:overflow-hidden',
].join(' ');

const TableFrameContext = React.createContext(false);

export interface PageFrameProps {
  /** Pinned above the body — usually a `PageHeader` carrying the page's actions. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Any page that is not a list: header held still, body the only scroller. */
export function PageFrame({ header, children, className }: Readonly<PageFrameProps>) {
  return (
    <div data-page-frame className="flex min-h-0 flex-1 flex-col">
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className={cn('relative min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>
    </div>
  );
}

export function useInTableFrame(): boolean {
  return React.useContext(TableFrameContext);
}

export interface TableFrameProps {
  /** Pinned above the card — usually a `PageHeader`. */
  header?: React.ReactNode;
  /** Pinned inside the card, above the table — filters, a context banner. */
  toolbar?: React.ReactNode;
  /** False scrolls the page instead. Pinning a tall create form leaves no table. */
  framed?: boolean;
  children: React.ReactNode;
}

/** A list screen: header and filters held still, the table body the only scroller. */
export function TableFrame({
  header,
  toolbar,
  framed = true,
  children,
}: Readonly<TableFrameProps>) {
  if (!framed) {
    return (
      <>
        {header}
        <Card className="p-4">
          {toolbar}
          {children}
        </Card>
      </>
    );
  }

  return (
    <TableFrameContext value={true}>
      <div data-page-frame className="flex min-h-0 flex-1 flex-col">
        {header ? <div className="shrink-0">{header}</div> : null}
        <Card className="flex min-h-0 flex-1 flex-col p-4">
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
          {children}
        </Card>
      </div>
    </TableFrameContext>
  );
}
