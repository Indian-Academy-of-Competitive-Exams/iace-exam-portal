/**
 * A pane the candidate moves by its scrollbar or the Up and Down keys alone: the wheel is
 * refused unless a skin asks for it, so a copied paper cannot be skimmed past by accident.
 * The bar is drawn here rather than left to the platform, and shows only while the pane is
 * being moved or the pointer is on it. Each skin colours it in its own css.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@iace/ui';
import './scroll-pane.css';

const THUMB_MIN_PX = 28;
/** One press of an arrow key: about a line and a half of the paper's text. */
const KEY_STEP_PX = 48;
/** How long the bar stays after the pane last moved. */
const BAR_LINGER_MS = 1200;
const AT_REST = { height: 0, top: 0, shown: false };
const STEP_BY_KEY: Readonly<Record<string, number>> = {
  ArrowDown: KEY_STEP_PX,
  ArrowUp: -KEY_STEP_PX,
};

/** Every pane that answers the arrow keys, in the order they were drawn, and the one under the pointer. */
const keyed: HTMLDivElement[] = [];
let hovered: HTMLDivElement | null = null;

const overflows = (node: HTMLDivElement) => node.scrollHeight > node.clientHeight;

/** The pane a key moves: the one under the pointer when it has more to show, else the first that does. */
function keyTarget(): HTMLDivElement | undefined {
  return hovered && keyed.includes(hovered) && overflows(hovered) ? hovered : keyed.find(overflows);
}

export function ScrollPane({
  className,
  keys = false,
  wheel = false,
  children,
}: Readonly<{
  className?: string;
  /** Lets the mouse wheel through, for a skin that copies no paper and scrolls like any page. */
  wheel?: boolean;
  /** Answers the Up and Down keys, for a pane that holds the paper itself. */
  keys?: boolean;
  children: ReactNode;
}>) {
  const pane = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState(AT_REST);
  const [moving, setMoving] = useState(false);
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    });
  }, []);

  const moved = useCallback(() => {
    measure();
    setMoving(true);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => setMoving(false), BAR_LINGER_MS);
  }, [measure]);

  useEffect(() => () => clearTimeout(rest.current), []);

  useEffect(() => {
    const node = pane.current;
    if (!node) return;

    // Sideways is let through: a table wider than the pane has no other way across.
    const refuse = (event: WheelEvent) => {
      if (!wheel && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) event.preventDefault();
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
  }, [measure, wheel]);

  useEffect(() => {
    const node = pane.current;
    if (!keys || !node) return;
    keyed.push(node);

    const step = (event: KeyboardEvent) => {
      const by = STEP_BY_KEY[event.key];
      // A paper under a warning is inert: its keys are not the candidate's to scroll with.
      if (by === undefined || node.closest('[inert]')) return;
      // A typing box moves its own caret with these keys, and must keep them.
      if (event.target instanceof HTMLTextAreaElement) return;
      // Kept from an option whether or not anything scrolls, or the key moves the view on one question and the answer on the next.
      if (event.target instanceof HTMLInputElement && event.target.type === 'radio') {
        event.preventDefault();
      }
      if (keyTarget() !== node) return;
      event.preventDefault();
      node.scrollTop += by;
    };
    window.addEventListener('keydown', step);

    return () => {
      window.removeEventListener('keydown', step);
      keyed.splice(keyed.indexOf(node), 1);
      if (hovered === node) hovered = null;
    };
  }, [keys]);

  const dragThumb = (event: PointerEvent<HTMLDivElement>) => {
    const node = pane.current;
    if (!node) return;
    event.preventDefault();

    const fromY = event.clientY;
    const fromTop = node.scrollTop;
    const travel = node.clientHeight - thumb.height;
    const hidden = node.scrollHeight - node.clientHeight;

    const move = (dragged: globalThis.PointerEvent) => {
      node.scrollTop = fromTop + ((dragged.clientY - fromY) / travel) * hidden;
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
  };

  return (
    <div
      className={cn('xp-scrollwrap', className)}
      data-moving={moving || undefined}
      onPointerEnter={() => {
        hovered = pane.current;
      }}
      onPointerLeave={() => {
        if (hovered === pane.current) hovered = null;
      }}
    >
      <div ref={pane} className="xp-scrollpane" onScroll={moved}>
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
    </div>
  );
}
