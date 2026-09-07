import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import { Button, PageHeader, TableFrame } from '@iace/ui';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { SeriesList } from './test-series';
import { TestsList } from './tests';

/** Two levels of one idea: a test reaches a student only through a series, so they read together. */

const VIEW = { SERIES: 'series', TESTS: 'tests' } as const;

export function TestsAndSeriesPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const filters = useFilters<'view' | 'q' | 'examId' | 'examStageId' | 'kind' | 'isEnabled'>();
  const view = filters.get('view') || VIEW.SERIES;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Tests & Test Series"
      // A test is built inside the series that carries it, so only a series is made from here.
      action={
        canWrite && view === VIEW.SERIES ? (
          <Button size="sm" asChild>
            <Link to={ROUTES.TEST_SERIES_NEW}>
              <Plus aria-hidden />
              New series
            </Link>
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <TableFrame
      header={header}
      tabs={{
        value: view,
        // The two lists share `q` and `examId`, so a switch leaves neither behind narrowing the other.
        onValueChange: (value) =>
          filters.set({ view: value, q: '', examId: '', examStageId: '', kind: '', isEnabled: '' }),
        items: [
          { value: VIEW.SERIES, label: 'Series', content: <SeriesList /> },
          { value: VIEW.TESTS, label: 'All tests', content: <TestsList /> },
        ],
      }}
    />
  );
}
