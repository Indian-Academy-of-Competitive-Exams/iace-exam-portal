import { PageFrame, Skeleton } from '@iace/ui';
import { PageBody } from './page-body';
import { TileGrid } from './tile-grid';

/** Keys, because a placeholder has no identity and an index key would be the only alternative. */
const SLOTS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** The band of figures a student screen opens on, held at its real height so nothing jumps. */
export function BandSkeleton() {
  return <Skeleton variant="row" className="h-24 rounded-xl" />;
}

/** The supporting grid under a hero. */
export function TilesSkeleton({ count = 3 }: Readonly<{ count?: number }>) {
  return (
    <TileGrid>
      {SLOTS.slice(0, count).map((slot) => (
        <Skeleton key={slot} variant="kpi" />
      ))}
    </TileGrid>
  );
}

/** One card-shaped block — a figure, a panel, a paper. */
export function BlockSkeleton({ className = 'h-64' }: Readonly<{ className?: string }>) {
  return <Skeleton variant="row" className={`${className} rounded-xl`} />;
}

/** Blocks side by side, the way the figures on a report sit. */
export function BlockPairSkeleton() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <BlockSkeleton />
      <BlockSkeleton />
    </div>
  );
}

/** A stack of divided rows, for a list whose row height is known. */
export function RowsSkeleton({ rows = 3 }: Readonly<{ rows?: number }>) {
  return (
    <div className="flex flex-col gap-3">
      {SLOTS.slice(0, rows).map((slot) => (
        <Skeleton key={slot} variant="row" className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

/** What a whole report tab loads into: its headline, its figures, then its table. */
export function ReportSkeleton() {
  return (
    <PageBody>
      <BandSkeleton />
      <TilesSkeleton count={5} />
      <BlockPairSkeleton />
    </PageBody>
  );
}

/** A lazy route's wait: the chunk owns the frame, so its fallback has to bring one of its own. */
export function PageSkeleton() {
  return (
    <PageFrame>
      <ReportSkeleton />
    </PageFrame>
  );
}
