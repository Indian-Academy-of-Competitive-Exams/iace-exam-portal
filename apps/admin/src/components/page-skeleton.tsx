import { PageFrame, Skeleton } from '@iace/ui';

/** A lazy route's wait: the frame holds its shape so nothing shifts when the chunk lands. */
export function PageSkeleton() {
  return (
    <PageFrame>
      <div className="flex flex-col gap-4">
        <Skeleton variant="row" className="h-24 rounded-xl" />
        <Skeleton variant="row" className="h-96 rounded-xl" />
      </div>
    </PageFrame>
  );
}
