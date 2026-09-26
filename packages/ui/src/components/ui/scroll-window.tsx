import * as React from 'react';
import { Dialog, DialogContent, DialogTitle } from './dialog';

export interface ScrollWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the window for a screen reader; the pinned header is what the eye reads. */
  title: string;
  /** Pinned above the scroll, and redrawn for whichever item is in view. */
  header: React.ReactNode;
  itemKeys: readonly string[];
  renderItem: (index: number) => React.ReactNode;
  onActiveChange: (index: number) => void;
  /** Scrolls this item to the top each time a new request arrives. */
  scrollTo?: { key: string } | null;
  /** Items either side of the one in view that keep a live body; the rest hold their last height. */
  overscan?: number;
  estimatedHeight?: number;
}

/** The reading line, as a share of the window's height: the item across it is the one being read. */
const READING_LINE = 1 / 2;

/** Every item stacked in one scroll under a header that follows the item in view. */
export function ScrollWindow({
  open,
  onOpenChange,
  title,
  header,
  itemKeys,
  renderItem,
  onActiveChange,
  scrollTo = null,
  overscan = 2,
  estimatedHeight = 480,
}: Readonly<ScrollWindowProps>) {
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const wrappers = React.useRef<(HTMLDivElement | null)[]>([]);
  const heights = React.useRef(new Map<string, number>());
  const [active, setActive] = React.useState(0);

  const findActive = React.useCallback(() => {
    const view = scroller.current;
    if (!view) return;
    const top = view.scrollTop + view.clientHeight * READING_LINE;
    let found = 0;
    wrappers.current.forEach((wrapper, index) => {
      if (wrapper && wrapper.offsetTop <= top) found = index;
    });
    // A short last item never reaches the top; at the bottom of the scroll it is the one being read.
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 2) found = itemKeys.length - 1;
    setActive((current) => (current === found ? current : found));
  }, [itemKeys.length]);

  React.useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);

  React.useEffect(() => {
    if (!scrollTo) return;
    const index = itemKeys.indexOf(scrollTo.key);
    const land = () => {
      const wrapper = wrappers.current[index];
      if (scroller.current && wrapper) scroller.current.scrollTop = wrapper.offsetTop;
    };
    land();
    // Items near the landing mount and take their real height, so land once more after they do.
    const settle = requestAnimationFrame(() => requestAnimationFrame(land));
    return () => cancelAnimationFrame(settle);
  }, [scrollTo, itemKeys]);

  const observer = React.useRef<ResizeObserver | null>(null);
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const watching = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (target.dataset.live && target.dataset.itemKey) {
          heights.current.set(target.dataset.itemKey, target.offsetHeight);
        }
      }
    });
    observer.current = watching;
    for (const wrapper of wrappers.current) if (wrapper) watching.observe(wrapper);
    return () => watching.disconnect();
  }, []);

  /** A resting item keeps the height it last had, so the scroll does not jump as bodies come and go. */
  const hold = (node: HTMLDivElement | null, index: number, key: string, live: boolean) => {
    wrappers.current[index] = node;
    if (!node) return;
    node.style.height = live ? '' : `${heights.current.get(key) ?? estimatedHeight}px`;
    observer.current?.observe(node);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="window" showClose={false} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex-none border-b border-border">{header}</div>
        <div
          ref={scroller}
          onScroll={findActive}
          className="relative min-h-0 flex-1 overflow-y-auto rounded-b-[--modal-radius]"
        >
          {itemKeys.map((key, index) => {
            const live = Math.abs(index - active) <= overscan;
            return (
              <div
                key={key}
                data-item-key={key}
                data-live={live ? 'true' : undefined}
                ref={(node) => hold(node, index, key, live)}
                className="border-b-8 border-muted"
              >
                {live ? renderItem(index) : null}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
