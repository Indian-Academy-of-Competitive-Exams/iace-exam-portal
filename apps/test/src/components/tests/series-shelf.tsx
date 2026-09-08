import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { TruncatedText, cn, linkVariants, plural } from '@iace/ui';
import { type StudentCatalogSeries } from '@iace/contracts';
import { ROUTES } from '../../lib/constants';
import { seriesProgress, type Sittable, type TestResult } from '../../lib/catalog';
import { Shelf } from '../ui';
import { TestTile } from './test-tile';

export interface SeriesShelfProps {
  series: StudentCatalogSeries;
  rows: readonly Sittable[];
  now: Date;
  /** What each sat paper scored, keyed by test id — the trend the screen already holds. */
  results: ReadonlyMap<string, TestResult>;
}

export function SeriesShelf({ series, rows, now, results }: Readonly<SeriesShelfProps>) {
  const progress = seriesProgress(series);

  return (
    <Shelf
      title={
        // The name IS the way in, so the icon is sized by this link rather than at the glyph.
        <Link
          className={cn(linkVariants(), 'flex min-w-0 items-center gap-1 [&_svg]:size-4')}
          to={ROUTES.SERIES(series.id)}
        >
          <TruncatedText className="text-lg font-semibold tracking-tight">
            {series.name}
          </TruncatedText>
          <ChevronRight aria-hidden className="shrink-0" />
        </Link>
      }
      meta={`${plural(progress.total, 'test')} · ${progress.done} sat`}
    >
      {rows.map((row) => (
        <TestTile key={row.test.id} row={row} now={now} result={results.get(row.test.id)} />
      ))}
    </Shelf>
  );
}
