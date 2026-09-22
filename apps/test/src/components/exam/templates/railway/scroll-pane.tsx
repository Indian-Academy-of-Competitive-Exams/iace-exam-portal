/**
 * A pane the candidate moves by its scrollbar alone: the wheel is refused, so a paper
 * cannot be skimmed past by accident. The bar is drawn here rather than left to the
 * platform, because a macOS overlay scrollbar reserves no width and only shows itself
 * during the very gesture this pane refuses.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@iace/ui';

const THUMB_MIN_PX = 28;

export function ScrollPane({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  const pane = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0, shown: false });

  const measure = useCallback(() => {
    const node = pane.current;
    if (!node) return;

    const hidden = node.scrollHeight - node.clientHeight;
    if (hidden <= 0) {
      setThumb({ height: 0, top: 0, shown: false });
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
    });
  }, []);

  useEffect(() => {
    const node = pane.current;
    if (!node) return;

    const refuse = (event: WheelEvent) => event.preventDefault();
    node.addEventListener('wheel', refuse, { passive: false });

    const watch = new ResizeObserver(measure);
    watch.observe(node);
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

  return (
    <div className={cn('rw-scrollwrap', className)}>
      <div ref={pane} className="rw-scrollpane" onScroll={measure}>
        {children}
      </div>
      {thumb.shown ? (
        <div className="rw-scrolltrack">
          {/* A picture of the scrollport beside it, not a control: the pane itself is what scrolls. */}
          <div
            aria-hidden
            className="rw-scrollthumb"
            style={{ height: `${thumb.height}px`, transform: `translateY(${thumb.top}px)` }}
            onPointerDown={dragThumb}
          />
        </div>
      ) : null}
    </div>
  );
}
