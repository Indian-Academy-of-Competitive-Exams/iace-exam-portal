import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFilters } from '@iace/app-kit/browser';
import { CalendarClock, CircleCheck, LockKeyhole } from 'lucide-react';
import {
  INSTITUTE_TIME_ZONE,
  TEST_BUCKET,
  testAction,
  testBucket,
  type StudentCatalogSeries,
  type StudentCatalogTest,
  type TestBucket,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  PageFrame,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY, ROUTES } from '../lib/constants';

/** The student's tests, in the four states one can be in. Cards, because §5 asks for cards. */

/** The URL key the open tab rides on, so a link can point at one. */
export const TAB_KEY = 'tab';

const TAB_LABELS: Readonly<Record<TestBucket, string>> = {
  [TEST_BUCKET.OPEN]: 'Open now',
  [TEST_BUCKET.LATER]: 'Later',
  [TEST_BUCKET.MISSED]: 'Missed',
  [TEST_BUCKET.DONE]: 'Done',
};

const TAB_ORDER: readonly TestBucket[] = [
  TEST_BUCKET.OPEN,
  TEST_BUCKET.LATER,
  TEST_BUCKET.MISSED,
  TEST_BUCKET.DONE,
];

const EMPTY: Readonly<Record<TestBucket, string>> = {
  [TEST_BUCKET.OPEN]: 'Nothing is open right now. What is coming is under Later.',
  [TEST_BUCKET.LATER]: 'Nothing is waiting. Everything you can reach is open now.',
  [TEST_BUCKET.MISSED]: 'You have missed nothing.',
  [TEST_BUCKET.DONE]: 'You have not finished a test yet.',
};

/** The institute's clock, wherever the student is sitting. */
const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface Sittable {
  test: StudentCatalogTest;
  seriesName: string;
}

const SKELETON_KEYS = ['a', 'b', 'c'];

export function TestsPage() {
  // The open tab rides the URL, so submitting can land a student on the one holding their test.
  const params = useFilters<typeof TAB_KEY>();
  const asked = params.get(TAB_KEY) as TestBucket | '';
  const tab = TAB_ORDER.includes(asked as TestBucket) ? (asked as TestBucket) : TEST_BUCKET.OPEN;

  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });

  const ask = useMutation({
    meta: { success: 'Asked. You will hear when it is answered.' },
    mutationFn: (testSeriesId: string) => api.me.askForSeries(testSeriesId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
  });

  const shut = (catalog.data?.series ?? []).filter((series) => series.canRequestUnlock);

  const now = new Date();
  const all = flatten(catalog.data?.series ?? []);
  const bucketed = (bucket: TestBucket) =>
    all.filter((row) => testBucket(row.test, now) === bucket);

  return (
    <PageFrame header={<PageHeader title="Tests" meta={plural(all.length, 'test')} />}>
      {catalog.data?.testBlocked ? (
        <Alert variant="danger">
          Your test access is on hold. Speak to your branch — nothing here can be started until it
          is lifted.
        </Alert>
      ) : null}

      {shut.map((series) => (
        <ShutSeries
          key={series.id}
          series={series}
          onAsk={() => ask.mutate(series.id)}
          asking={ask.isPending}
        />
      ))}

      <Tabs value={tab} onValueChange={(next) => params.set({ [TAB_KEY]: next })}>
        <TabsList>
          {TAB_ORDER.map((bucket) => (
            <TabsTrigger key={bucket} value={bucket}>
              {TAB_LABELS[bucket]}
              {bucketed(bucket).length > 0 ? (
                <Badge variant="neutral">{bucketed(bucket).length}</Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_ORDER.map((bucket) => (
          <TabsContent key={bucket} value={bucket}>
            {catalog.isLoading ? (
              <div className="flex flex-col gap-3">
                {SKELETON_KEYS.map((key) => (
                  <Skeleton key={key} variant="row" className="h-28 rounded-lg" />
                ))}
              </div>
            ) : (
              <TestCards rows={bucketed(bucket)} empty={EMPTY[bucket]} now={now} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </PageFrame>
  );
}

function TestCards({
  rows,
  empty,
  now,
}: Readonly<{ rows: readonly Sittable[]; empty: string; now: Date }>) {
  if (rows.length === 0) return <Alert variant="info">{empty}</Alert>;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((row) => (
        <TestCard key={row.test.id} row={row} now={now} />
      ))}
    </div>
  );
}

function TestCard({ row, now }: Readonly<{ row: Sittable; now: Date }>) {
  const { test } = row;
  const action = testAction(test);
  const done = testBucket(test, now) === TEST_BUCKET.DONE;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {test.title ?? 'Untitled test'}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{row.seriesName}</p>
        </div>

        {done ? (
          /* ui-copy-ok: consequence */
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck aria-hidden className="size-3.5 shrink-0 text-success" />
            Result once it is marked
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock aria-hidden className="size-3.5 shrink-0" />
            {whenLine(test, now)}
          </p>
        )}

        {action ? (
          <Button asChild size="sm" className="self-start">
            <Link to={ROUTES.TEST_INSTRUCTIONS(test.id)}>{resumeOrStart(action, done)}</Link>
          </Button>
        ) : (
          <p className="flex items-center gap-1.5 self-start text-xs text-muted-foreground">
            <LockKeyhole aria-hidden className="size-3.5 shrink-0" />
            {shutReason(test, now)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** What the clock says about this test, in the one line a card has room for. */
function whenLine(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) {
    return `Opens ${WHEN.format(new Date(test.opensAt))}`;
  }
  if (test.closesAt !== null) {
    const closed = Date.parse(test.closesAt) <= now.getTime();
    return `${closed ? 'Entry closed' : 'Entry closes'} ${WHEN.format(new Date(test.closesAt))}`;
  }
  return 'No fixed time — sit it whenever you are ready';
}

/** A shut series names what opens it, and carries the only thing the student can do about it. */
function ShutSeries({
  series,
  onAsk,
  asking,
}: Readonly<{ series: StudentCatalogSeries; onAsk: () => void; asking: boolean }>) {
  return (
    <Alert variant="info" className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-start gap-2">
          <LockKeyhole aria-hidden />
          <span>
            <strong className="font-medium">{series.name}</strong>{' '}
            {series.prerequisiteSeriesName === null
              ? 'is not open to you yet.'
              : `opens once you have finished every test in ${series.prerequisiteSeriesName}.`}
          </span>
        </span>
        {series.unlockRequested ? (
          <Badge variant="neutral">Asked — waiting to be answered</Badge>
        ) : (
          <Button size="sm" disabled={asking} onClick={onAsk}>
            Ask to open it now
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** Why there is no button. "Waiting its turn" is not an error and must not read like one. */
function shutReason(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) return 'Not open yet';
  if (test.closesAt !== null && Date.parse(test.closesAt) <= now.getTime()) return 'Entry closed';
  return 'Finish the test before it first';
}

function flatten(series: readonly StudentCatalogSeries[]): Sittable[] {
  return series.flatMap((one) => one.tests.map((test) => ({ test, seriesName: one.name })));
}

/** A sat test with a retake left says so: "Start test" would read as though it never happened. */
function resumeOrStart(action: 'START' | 'RESUME', done: boolean): string {
  if (action === 'RESUME') return 'Resume test';
  return done ? 'Sit it again' : 'Start test';
}
