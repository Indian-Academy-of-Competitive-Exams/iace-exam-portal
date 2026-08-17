import * as React from 'react';
import { Card } from './card';

/**
 * The app shell's content wrapper. It lives beside `data-page-frame` below rather
 * than in the shell so the attribute and the selector matching it cannot drift.
 */
export const PAGE_CONTENT_CLASS = [
  // The padding is unconditional: a framed page is a flex child, so it shortens to
  // fit rather than needing the room. Zeroing the bottom sat the card on the page edge.
  'mx-auto w-full flex-1 overflow-y-auto px-5 py-8',
  // A framed page scrolls its own body, so the wrapper hands over the height and
  // stops scrolling. Where `:has()` is unsupported the page simply scrolls.
  'has-[[data-page-frame]]:flex has-[[data-page-frame]]:flex-col',
  'has-[[data-page-frame]]:overflow-hidden',
].join(' ');

const TableFrameContext = React.createContext(false);

/** True inside a framed page, where the table body is the only thing that scrolls. */
export function useInTableFrame(): boolean {
  return React.useContext(TableFrameContext);
}

export interface TableFrameProps {
  /** Pinned above the card — usually a `PageHeader`. */
  header?: React.ReactNode;
  /** Pinned inside the card, above the table — filters, a context banner. */
  toolbar?: React.ReactNode;
  /**
   * False falls back to a scrolling page. Pass it while an inline create form is
   * open: pinning a tall form would leave the table no height to scroll in.
   */
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
