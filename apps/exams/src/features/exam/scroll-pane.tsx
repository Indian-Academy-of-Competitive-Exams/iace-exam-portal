/**
 * A pane the candidate moves by its scrollbar or its two arrows alone: the wheel is
 * refused, so a paper cannot be skimmed past by accident. The bar is drawn here rather
 * than left to the platform, because a macOS overlay scrollbar reserves no width and only
 * shows itself during the very gesture this pane refuses. Each skin colours it in its css.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@iace/ui';
import './scroll-pane.css';

const THUMB_MIN_PX = 28;
/** Sub-pixel layouts leave a fraction unscrolled at either end; within one pixel is the end. */
const END_SLACK_PX = 1;
const AT_REST = { height: 0, top: 0, shown: false, above: false, below: false };

export function ScrollPane({
  className,
  arrows = false,
  children,
}: Readonly<{
  className?: string;
  /** The two jumps to the top and the bottom, for a pane that holds the paper itself. */
  arrows?: boolean;
  children: ReactNode;
}>) {
  const pane = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState(AT_REST);

  const measure = useCallback(() => {
    const node = pane.current;
    if (!node) return;

    const hidden = node.scrollHeight - node.clientHeight;
    if (hidden <= 0) {
      setThumb(AT_REST);
      return;
    }

    const height = Math.max(
      THUMB_MIN_PX,
      (node.clientHeight / node.scrollHeight) * node.clientHeight,
    );
    setThumb({
      height,
      top: (node.scrollTop / hidden) * (node.clientHeight - height),
      shown: true,
      above: node.scrollTop > END_SLACK_PX,
      below: hidden - node.scrollTop > END_SLACK_PX,
    });
  }, []);

  useEffect(() => {
    const node = pane.current;
    if (!node) return;

    // Sideways is let through: a table wider than the pane has no other way across.
    const refuse = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) event.preventDefault();
    };
    node.addEventListener('wheel', refuse, { passive: false });

    // The pane's own box does not change when the question does — only what is inside it does.
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    if (content.current) watch.observe(content.current);
    measure();

    return () => {
      node.removeEventListener('wheel', refuse);
      watch.disconnect();
    };
  }, [measure]);

  const dragThumb = (event: PointerEvent<HTMLDivElement>) => {
    const node = pane.current;
    if (!node) return;
    event.preventDefault();

    const fromY = event.clientY;
    const fromTop = node.scrollTop;
    const travel = node.clientHeight - thumb.height;
    const hidden = node.scrollHeight - node.clientHeight;

    const move = (moved: globalThis.PointerEvent) => {
      node.scrollTop = fromTop + ((moved.clientY - fromY) / travel) * hidden;
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
  };

  const jumpTo = (top: number) => pane.current?.scrollTo({ top });

  return (
    <div
      className={cn('xp-scrollwrap', className)}
      data-arrows={(arrows && thumb.shown) || undefined}
    >
      <div ref={pane} className="xp-scrollpane" onScroll={measure}>
        <div ref={content}>{children}</div>
      </div>
      {thumb.shown ? (
        <div className="xp-scrolltrack">
          {/* A picture of the scrollport beside it, not a control: the pane itself is what scrolls. */}
          <div
            aria-hidden
            className="xp-scrollthumb"
            style={{ height: `${thumb.height}px`, transform: `translateY(${thumb.top}px)` }}
            onPointerDown={dragThumb}
          />
        </div>
      ) : null}
      {arrows && thumb.above ? (
        <button
          type="button"
          aria-label="Go to the top"
          className="xp-scrolljump xp-scrolljump-up"
          onClick={() => jumpTo(0)}
        >
          <ArrowUp aria-hidden />
        </button>
      ) : null}
      {arrows && thumb.below ? (
        <button
          type="button"
          aria-label="Go to the bottom"
          className="xp-scrolljump xp-scrolljump-down"
          onClick={() => jumpTo(pane.current?.scrollHeight ?? 0)}
        >
          <ArrowDown aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
