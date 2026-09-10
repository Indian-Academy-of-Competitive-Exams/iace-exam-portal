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

/** Bled back out to the content region so the bar rides its edge, not the text it sits beside. */
const REGION_BLEED = '-mx-5 px-5 xl:-mx-8 xl:px-8 2xl:-mx-10 2xl:px-10 [scrollbar-gutter:stable]';

const TableFrameContext = React.createContext(false);

/** The spec a screen declares and the state driving it — one shape, whichever frame renders it. */
export interface FrameFilters {
  spec: readonly ListFilter[];
  state: FilterState;
  /** A mandatory scope the body is read through, never one of its filters — first in the bar. */
  leading?: React.ReactNode;
}

export interface PageFrameProps {
  /** Pinned above the body — usually a `PageHeader` carrying the page's actions. */
  header?: React.ReactNode;
  /** Pinned under the header, so a browse screen narrows without its controls scrolling away. */
  filters?: FrameFilters;
  /** Sits the controls BESIDE the title instead of under it — for a header with no action. */
  filtersBesideTitle?: boolean;
  /** Views of one record, on the background rather than inside a card. */
  tabs?: TableFrameTabs;
  /** Hands the scrolling to the children — for a body whose table should scroll, not the page. */
  fills?: boolean;
  /** Pinned under the body, drawing no rule of its own: a `Pagination` brings its own edge. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/** Any page that is not a list: header held still, body the only scroller. */
export function PageFrame({
  header,
  filters,
  filtersBesideTitle = false,
  tabs,
  fills = false,
  footer,
  children,
  className,
}: Readonly<PageFrameProps>) {
  // `relative`, because an absolutely positioned descendant of a static scroller escapes it.
  const scroller = fills
    ? cn(FILLS, className)
    : cn('relative min-h-0 flex-1 overflow-y-auto', REGION_BLEED, className);

  const body = tabs ? (
    <>
      <div className="mb-4 flex shrink-0 items-center gap-3 border-b border-border">
        <TabsList className="min-w-0 flex-1 border-b-0">
          {tabs.items.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.action ? (
          <span className="flex shrink-0 items-center gap-2">{tabs.action}</span>
        ) : null}
      </div>
      {tabs.items.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className={cn(scroller, 'pt-0')}>
          {tab.content}
        </TabsContent>
      ))}
    </>
  ) : (
    <div className={scroller}>{children}</div>
  );

  // A title with nothing beside it leaves the row empty, so the controls take that space.
  const top = filtersBesideTitle ? (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4">
      <div className="min-w-0 flex-1">{header}</div>
      <FrameFilterRow filters={filters} beside />
    </div>
  ) : (
    <>
      {header ? <div className="shrink-0">{header}</div> : null}
      <FrameFilterRow filters={filters} />
    </>
  );

  const frame = (
    <div data-page-frame className={FILLS}>
      {top}
      {body}
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );

  // The context is what tells a table inside to fill its pane rather than cap itself half way down.
  const rooted = fills ? <TableFrameContext value={true}>{frame}</TableFrameContext> : frame;

  return tabs ? (
    <Tabs value={tabs.value} onValueChange={tabs.onValueChange} className={FILLS}>
      {rooted}
    </Tabs>
  ) : (
    rooted
  );
}

/** Nothing to narrow by is no bar at all — an empty strip of chrome reads as a broken one. */
function FrameFilterRow({
  filters,
  beside = false,
}: Readonly<{ filters?: FrameFilters; beside?: boolean }>) {
  if (!filters || (filters.spec.length === 0 && !filters.leading)) return null;

  // The bar sits on the PAGE here, so its controls and their notches paint the page, not a card.
  return (
    <div
      className={cn(
        'shrink-0 [--surface:var(--background)]',
        // Beside a title the controls belong at the region's edge, not adrift in the middle.
        beside && 'flex min-w-0 flex-1 justify-end',
      )}
    >
      <FilterRow state={filters.state} filters={filters.spec} leading={filters.leading} />
    </div>
  );
}

export interface PanelFrameProps {
  /** Pinned above the card — usually a `PageHeader`. */
  header?: React.ReactNode;
  /** Pinned inside the card, above the filters — a banner the body does not own. */
  toolbar?: React.ReactNode;
  /** The spec a list screen would declare, and the state driving it. */
  filters?: FrameFilters;
  /** Lifts the controls OUT of the card, beside the title — for a header with no action. */
  filtersBesideTitle?: boolean;
  /** Views of one record. The strip sits inside the card and holds still, as a list's does. */
  tabs?: TableFrameTabs;
  /** Hands the scrolling to the children — for a body that is itself two panes, each its own. */
  fills?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** `TableFrame` for content that is no table: same card and strip, the body scrolling unless `fills`. */
export function PanelFrame({
  header,
  toolbar,
  filters,
  filtersBesideTitle = false,
  tabs,
  fills,
  children,
  className,
}: Readonly<PanelFrameProps>) {
  // `relative`, because an absolutely positioned descendant of a static scroller escapes it.
  const scroller = cn(fills ? FILLS : 'relative min-h-0 flex-1 overflow-y-auto', className);

  const bar =
    filters && (filters.spec.length > 0 || filters.leading) && !filtersBesideTitle ? (
      <div className="shrink-0">
        <FilterRow state={filters.state} filters={filters.spec} leading={filters.leading} />
      </div>
    ) : null;

  const body = tabs ? (
    <>
      {/* Bled past the card's padding so the rule reaches its edges, not a floating line. */}
      <div className="-mx-4 mb-4 flex shrink-0 items-center gap-3 border-b border-border px-4">
        <TabsList className="min-w-0 flex-1 border-b-0">
          {tabs.items.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.action ? (
          <span className="flex shrink-0 items-center gap-2">{tabs.action}</span>
        ) : null}
      </div>
      {tabs.items.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className={cn(scroller, 'pt-0')}>
          {tab.content}
        </TabsContent>
      ))}
    </>
  ) : (
    <div className={scroller}>{children}</div>
  );

  // A title with nothing beside it leaves the row empty, so the controls take that space.
  const top = filtersBesideTitle ? (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4">
      <div className="min-w-0 flex-1">{header}</div>
      <FrameFilterRow filters={filters} beside />
    </div>
  ) : (
    <>{header ? <div className="shrink-0">{header}</div> : null}</>
  );

  const frame = (
    <div data-page-frame className={FILLS}>
      {top}
      <Card className={cn(FILLS, 'p-4')}>
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        {bar}
        {body}
      </Card>
    </div>
  );

  // The context is what tells a table inside to fill its pane rather than cap itself half way down.
  const rooted = fills ? <TableFrameContext value={true}>{frame}</TableFrameContext> : frame;

  return tabs ? (
    <Tabs value={tabs.value} onValueChange={tabs.onValueChange} className={FILLS}>
      {rooted}
    </Tabs>
  ) : (
    rooted
  );
}

export function useInTableFrame(): boolean {
  return React.useContext(TableFrameContext);
}

export interface TableFrameTab {
  value: string;
  /** A node, so a tab can carry a chip; its text is still what names the tab to a reader. */
  label: React.ReactNode;
  content: React.ReactNode;
}

export interface TableFrameTabs {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly TableFrameTab[];
  /** Held at the strip's right end — what the open tab is acted on with, beside the tabs themselves. */
  action?: React.ReactNode;
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
