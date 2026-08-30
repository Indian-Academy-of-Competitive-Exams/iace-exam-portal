import { Link } from 'react-router-dom';
import { Button, Progress, TruncatedText, linkVariants, plural } from '@iace/ui';
import { ROUTES } from '../../lib/constants';
import { seriesProgress, type Sittable } from '../../lib/catalog';
import { type StudentCatalogSeries } from '@iace/contracts';
import { TestTile } from './test-tile';

export interface SeriesShelfProps {
  series: StudentCatalogSeries;
  rows: readonly Sittable[];
  now: Date;
}

/** A shelf scrolls SIDEWAYS inside the page's vertical scroll — a different axis hides nothing. */
export function SeriesShelf({ series, rows, now }: Readonly<SeriesShelfProps>) {
  const progress = seriesProgress(series);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link className={linkVariants()} to={ROUTES.SERIES(series.id)}>
            <TruncatedText className="text-sm font-semibold">{series.name}</TruncatedText>
          </Link>
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress.done} of {plural(progress.total, 'test')} done
          </span>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to={ROUTES.SERIES(series.id)}>Open series</Link>
        </Button>
      </div>

      <Progress value={progress.percent} size="sm" aria-label={`Progress through ${series.name}`} />

      <div className="relative flex snap-x gap-3 overflow-x-auto pb-2">
        {rows.map((row) => (
          <TestTile key={row.test.id} row={row} now={now} />
        ))}
      </div>
    </section>
  );
}
