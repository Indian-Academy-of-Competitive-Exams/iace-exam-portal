import { Inbox } from 'lucide-react';
import { EmptyState, SectionHeading } from '@iace/ui';
import { continueWith, openNow, upNext, type Sittable } from '../../lib/catalog';
import { TestTile } from './test-tile';

/** The daily action, one tap from landing: what is running, what is open, what is next. */
export function StatusStrip({ rows, now }: Readonly<{ rows: readonly Sittable[]; now: Date }>) {
  const running = continueWith(rows);
  const open = openNow(rows).filter((row) => row.test.id !== running?.test.id);
  const next = upNext(rows);

  if (!running && open.length === 0 && next.length === 0) {
    return <EmptyState icon={Inbox} title="Nothing waiting" level={3} />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Lane title="Continue" rows={running ? [running] : []} now={now} />
      <Lane title="Open now" rows={open.slice(0, 1)} now={now} />
      <Lane title="Up next" rows={next.slice(0, 1)} now={now} />
    </div>
  );
}

function Lane({
  title,
  rows,
  now,
}: Readonly<{ title: string; rows: readonly Sittable[]; now: Date }>) {
  return (
    <div className="flex flex-col gap-2">
      <SectionHeading title={title} level={3} />
      {rows.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        rows.map((row) => <TestTile key={row.test.id} row={row} now={now} />)
      )}
    </div>
  );
}
