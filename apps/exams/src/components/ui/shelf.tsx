import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button, cn } from '@iace/ui';

export interface ShelfProps {
  /** The plain noun for the shelf, and the way into it — a series name that is its own link. */
  title: React.ReactNode;
  /** The values behind it — how many, how far through. Never a sentence. */
  meta?: React.ReactNode;
  /** Where the whole of it is listed: a chevron at the row's end, while some of it does not fit. */
  all?: { to: string; label: string };
  /** One tile each. A shelf draws only the first of them that fit. */
  children: React.ReactNode;
  className?: string;
}

/** However wide the screen, a shelf is a sample of its series and never the list of it. */
const SHELF_MAX = 10;
/** 18rem, the narrowest a tile still reads at; 1rem between two; 2.5rem for the chevron. */
const TILE_MIN = 288;
const GAP = 16;
const CHEVRON = 40;

/** How many whole tiles a row has room for, which is its columns however few tiles there are to put in them. */
const columnsIn = (room: number): number =>
  Math.max(1, Math.min(SHELF_MAX, Math.floor((room + GAP) / (TILE_MIN + GAP))));

/** The row's columns, and whether tiles are left out — in which case one column's room goes to the chevron. */
function fitting(width: number, total: number): { columns: number; more: boolean } {
  const unaided = columnsIn(width);
  if (total <= unaided) return { columns: unaided, more: false };
  return { columns: columnsIn(width - CHEVRON - GAP), more: true };
}

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);

  // Before paint, so the row never draws one tile and then the rest.
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/** One row of the tiles that fit it, whole: nothing scrolls sideways, and what is left out is one tap away. */
export function Shelf({ title, meta, all, children, className }: Readonly<ShelfProps>) {
  const tiles = React.Children.toArray(children);
  const [row, width] = useWidth<HTMLDivElement>();
  const { columns, more } = fitting(width, tiles.length);

  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title}
        {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
      </div>
      <div
        ref={row}
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))${more && all ? ' auto' : ''}`,
        }}
      >
        {tiles.slice(0, columns)}
        {more && all ? (
          <Button asChild variant="outline" size="icon" className="self-center">
            <Link to={all.to} aria-label={all.label}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
