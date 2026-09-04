import * as React from 'react';
import { Card } from './card';
import { FilterRow, type FilterState, type ListFilter } from './list-view';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { cn } from '../../lib/utils';

/**
 * The app shell's content wrapper. Here rather than in the shell so this and the
 * `data-page-frame` below cannot drift apart. Unsupported `:has()` just scrolls.
 */
export const PAGE_CONTENT_CLASS = [
  // Unconditional: a framed page is a flex child, so it shortens to fit the padding.
  'mx-auto w-full flex-1 overflow-y-auto px-5 py-6 xl:px-8 2xl:px-10',
  'has-[[data-page-frame]]:flex has-[[data-page-frame]]:flex-col',
  'has-[[data-page-frame]]:overflow-hidden',
].join(' ');

/** Every ancestor between the frame and the table has to shrink, or the page takes the scroll. */
const FILLS = 'flex min-h-0 flex-1 flex-col';

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
    <div data-page-frame className={FILLS}>
      {header ? <div className="shrink-0">{header}</div> : null}
      {/* `pr-2` keeps right-aligned content clear of the scrollbar this very element draws. */}
      <div className={cn('relative min-h-0 flex-1 overflow-y-auto pr-2', className)}>
        {children}
      </div>
    </div>
  );
}

export interface PaneFrameProps {
  /** Pinned above the body — usually a `PageHeader`. */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** The one frame that does not scroll its own body — children own their scrolling instead. */
export function PaneFrame({ header, children, className }: Readonly<PaneFrameProps>) {
  return (
    <div data-page-frame className={FILLS}>
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className={cn('min-h-0 flex-1', className)}>{children}</div>
    </div>
  );
}

export interface PanelFrameProps {
  /** Pinned above the card — usually a `PageHeader`. */
  header?: React.ReactNode;
  /** Pinned inside the card, above the filters — a banner the body does not own. */
  toolbar?: React.ReactNode;
  /** The spec a list screen would declare, and the state driving it. */
  filters?: {
    spec: readonly ListFilter[];
    state: FilterState;
    /** A mandatory scope the body is read through, never one of its filters — first in the bar. */
    leading?: React.ReactNode;
  };
  /** Views of one record. The strip sits inside the card and holds still, as a list's does. */
  tabs?: TableFrameTabs;
  children?: React.ReactNode;
  className?: string;
}

/** `TableFrame` for content that is no table: same card and strip, but the BODY is the scroller. */
export function PanelFrame({
  header,
  toolbar,
  filters,
  tabs,
  children,
  className,
}: Readonly<PanelFrameProps>) {
  // `relative`, because an absolutely positioned descendant of a static scroller escapes it.
  const scroller = cn('relative min-h-0 flex-1 overflow-y-auto', className);

  const bar =
    filters && (filters.spec.length > 0 || filters.leading) ? (
      <div className="shrink-0">
        <FilterRow state={filters.state} filters={filters.spec} leading={filters.leading} />
      </div>
    ) : null;

  const body = tabs ? (
    <>
      {/* Bled past the card's padding so the rule reaches its edges, not a floating line. */}
      <TabsList className="-mx-4 mb-4 shrink-0 px-4">
        {tabs.items.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.items.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className={cn(scroller, 'pt-0')}>
          {tab.content}
        </TabsContent>
      ))}
    </>
  ) : (
    <div className={scroller}>{children}</div>
  );

  const frame = (
    <div data-page-frame className={FILLS}>
      {header ? <div className="shrink-0">{header}</div> : null}
      <Card className={cn(FILLS, 'p-4')}>
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        {bar}
        {body}
      </Card>
    </div>
  );

  return tabs ? (
    <Tabs value={tabs.value} onValueChange={tabs.onValueChange} className={FILLS}>
      {frame}
    </Tabs>
  ) : (
    frame
  );
}

export function useInTableFrame(): boolean {
  return React.useContext(TableFrameContext);
}

export interface TableFrameTab {
  value: string;
  label: string;
  content: React.ReactNode;
}

export interface TableFrameTabs {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly TableFrameTab[];
}

export interface TableFrameProps {
  /** Pinned above the card — usually a `PageHeader`. */
  header?: React.ReactNode;
  /** Pinned inside the card, above the table — a context banner a `ListView` does not own. */
  toolbar?: React.ReactNode;
  /** Sub-features close enough to be one idea. The strip sits inside the card, above the tab. */
  tabs?: TableFrameTabs;
  /** False scrolls the page instead. Pinning a tall create form leaves no table. */
  framed?: boolean;
  children?: React.ReactNode;
}

/** A list screen: header and filters held still, the table body the only scroller. */
export function TableFrame({
  header,
  toolbar,
  tabs,
  framed = true,
  children,
}: Readonly<TableFrameProps>) {
  const body = tabs ? (
    <>
      {/* Bled past the card's padding so the rule reaches its edges, not a floating line. */}
      <TabsList className="-mx-4 mb-4 px-4">
        {tabs.items.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.items.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className={cn(FILLS, 'pt-0')}>
          {tab.content}
        </TabsContent>
      ))}
    </>
  ) : (
    children
  );

  const unframed = (
    <>
      {header}
      <Card className="p-4">
        {toolbar}
        {body}
      </Card>
    </>
  );

  const frame = framed ? (
    <TableFrameContext value={true}>
      <div data-page-frame className={FILLS}>
        {header ? <div className="shrink-0">{header}</div> : null}
        <Card className={cn(FILLS, 'p-4')}>
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
          {body}
        </Card>
      </div>
    </TableFrameContext>
  ) : (
    unframed
  );

  // Both branches pass through here: a TabsList rendered outside a Tabs root throws.
  return tabs ? (
    <Tabs
      value={tabs.value}
      onValueChange={tabs.onValueChange}
      className={framed ? FILLS : undefined}
    >
      {frame}
    </Tabs>
  ) : (
    frame
  );
}
