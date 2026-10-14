/** What a student reads BEFORE the clock starts — ported from the web's `test-about.tsx`. */
import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import CalendarClock from 'lucide-react-native/icons/calendar-clock';
import LockKeyhole from 'lucide-react-native/icons/lock-keyhole';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  isBriefRefused,
  languagesOf,
  negativeOf,
  offersRetake,
  RETAKE_SAYS,
  sectionalOf,
  sectionMarksOf,
  SHUT_SAYS,
  shutOf,
  shutReason,
  totalMarksOf,
  NEEDS_KEYBOARD_SAYS,
  needsKeyboard,
  plural,
} from '@iace/app-kit';
import {
  instituteDateTimeLabel,
  TEST_BUCKET,
  TEST_SHUT,
  testAction,
  testBucket,
  type ExamBrief,
  type StudentCatalogTest,
} from '@iace/contracts';
import { Text } from '../../../src/components/ui/text';
import { briefQuery, catalogQuery } from '../../../src/lib/queries';
import { Alert } from '../../../src/components/ui/alert';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../../src/components/ui/empty-state';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { StatTile, StatTileRow } from '../../../src/components/ui/stat-tile';
import { ExamJourney } from '../../../src/components/tests/exam-journey';
import { PastAttempts } from '../../../src/components/tests/past-attempts';
import { DETAIL_ROUTES } from '../../../src/lib/nav';
import { cn } from '../../../src/lib/cn';
import { renderTourTrigger, usePageTour, useTourTarget } from '../../../src/lib/page-tour';
import { TEST_ABOUT_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../../src/lib/tours';
import Play from 'lucide-react-native/icons/play';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Layers from 'lucide-react-native/icons/layers';
import FileText from 'lucide-react-native/icons/file-text';
import { SectionTitle } from '../../../src/components/ui/section-title';
import ListOrdered from 'lucide-react-native/icons/list-ordered';
import Clock from 'lucide-react-native/icons/clock';
import Award from 'lucide-react-native/icons/award';
import CircleMinus from 'lucide-react-native/icons/circle-minus';
import { useTokenColor } from '../../../src/lib/use-token-color';

type Phase = 'LOADING' | 'REFUSED' | 'ERROR' | 'READY';

interface CatalogState {
  isLoading: boolean;
  isLoadingError: boolean;
  refetch: () => void;
}

/** A refusal replaces the screen whatever is held; any other failure only when nothing is. */
function phaseOf(brief: {
  isLoading: boolean;
  isError: boolean;
  isLoadingError: boolean;
  error: unknown;
}): Phase {
  if (brief.isLoading) return 'LOADING';
  if (brief.isError && isBriefRefused(brief.error)) return 'REFUSED';
  return brief.isLoadingError ? 'ERROR' : 'READY';
}

export default function TestAboutScreen() {
  const { id: testId } = useLocalSearchParams<{ id: string }>();
  const now = new Date();
  const catalog = useQuery(catalogQuery);
  const brief = useQuery(briefQuery(testId));

  const series = catalog.data?.series.find((row) => row.tests.some((test) => test.id === testId));
  const listed = series?.tests.find((test) => test.id === testId);

  usePageTour({ id: TOUR_IDS.TEST_ABOUT, steps: TEST_ABOUT_TOUR, ready: brief.isSuccess });

  return (
    <Fragment>
      <Stack.Screen
        options={{ title: brief.data?.title ?? 'Test', headerRight: renderTourTrigger }}
      />
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-6">
        <AboutContent
          phase={phaseOf(brief)}
          brief={brief.data}
          onRetry={brief.refetch}
          testId={testId}
          seriesName={series?.name}
          listed={listed}
          catalog={catalog}
          now={now}
        />
      </ScrollView>
    </Fragment>
  );
}

function AboutContent({
  phase,
  brief,
  onRetry,
  testId,
  seriesName,
  listed,
  catalog,
  now,
}: Readonly<{
  phase: Phase;
  brief: ExamBrief | undefined;
  onRetry: () => void;
  testId: string;
  seriesName: string | undefined;
  listed: StudentCatalogTest | undefined;
  catalog: CatalogState;
  now: Date;
}>) {
  const band = useTourTarget(TOUR_TARGETS.ABOUT_BAND);

  if (phase === 'LOADING') {
    return (
      <View className="gap-3">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </View>
    );
  }

  if (phase === 'REFUSED') {
    return <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This test is not open to you" />;
  }

  if (phase === 'ERROR' || !brief) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This test did not load"
        onRetry={onRetry}
      />
    );
  }

  return (
    <Fragment>
      <View className="gap-1">
        <Text variant="title">{brief.title ?? 'Test'}</Text>
        {seriesName ? <Text variant="muted">{seriesName}</Text> : null}
      </View>

      {listed ? <Window test={listed} /> : null}

      {listed ? <ShutNotice test={listed} now={now} /> : null}

      <View {...band}>
        <StatTileRow>
          <StatTile icon={ListOrdered} label="Questions" value={brief.totalQuestions} />
          <StatTile
            icon={Clock}
            label="Duration (minutes)"
            value={Math.round(brief.durationSec / 60)}
          />
          <StatTile icon={Award} label="Total marks" value={totalMarksOf(brief)} />
          <StatTile icon={CircleMinus} label="Negative" value={negativeOf(brief)} />
        </StatTileRow>
      </View>

      <SectionsCard brief={brief} />
      <PaperCard brief={brief} />

      <Exits
        testId={testId}
        listed={listed}
        catalog={catalog}
        now={now}
        needsKeyboard={needsKeyboard(brief)}
        journey={brief.journey}
      />

      <PastAttempts testId={testId} />
    </Fragment>
  );
}

/** What keeps a paper shut is a consequence, so it is an Alert: a hold is already wrong, an opening or a turn only a fact. */
function ShutNotice({ test, now }: Readonly<{ test: StudentCatalogTest; now: Date }>) {
  const bucket = testBucket(test);
  if (bucket === TEST_BUCKET.OPEN || bucket === TEST_BUCKET.DONE) return null;
  const shut = shutOf(test, now);
  if (shut === TEST_SHUT.HOLD) return <Alert variant="danger">{SHUT_SAYS[shut].notice}</Alert>;

  return (
    <Alert icon={shut === TEST_SHUT.NOT_OPEN ? CalendarClock : LockKeyhole}>
      {SHUT_SAYS[shut].notice}
    </Alert>
  );
}

/** A time is prose, not a figure: set at a headline size it shouts over the title above it. */
function Window({ test }: Readonly<{ test: StudentCatalogTest }>) {
  const ink = useTokenColor('--muted-foreground');

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-1.5">
        <CalendarClock size={14} color={ink} />
        <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Opens
        </Text>
      </View>
      <Text className="text-base font-semibold text-foreground">
        {test.opensAt === null ? 'Any time' : instituteDateTimeLabel(test.opensAt)}
      </Text>
    </View>
  );
}

function SectionsCard({ brief }: Readonly<{ brief: ExamBrief }>) {
  const anchor = useTourTarget(TOUR_TARGETS.ABOUT_SECTIONS);

  return (
    <View className="gap-2" {...anchor}>
      <View className="flex-row items-baseline justify-between">
        <SectionTitle icon={Layers}>Sections</SectionTitle>
        <Text variant="muted">{plural(brief.sections.length, 'section')}</Text>
      </View>
      <Card>
        {brief.sections.map((section, index) => (
          <View
            key={section.id}
            className={cn('gap-1.5 p-4', index > 0 && 'border-t border-border')}
          >
            <Text numberOfLines={1} className="text-sm font-medium text-foreground">
              {section.name}
            </Text>
            <InfoRow label="Questions" value={String(section.questionCount)} />
            <InfoRow label="Marks each" value={String(section.marksPerQuestion)} />
            <InfoRow label="Negative" value={String(section.negativeMarks)} />
            <InfoRow label="Section marks" value={String(sectionMarksOf(section))} />
          </View>
        ))}
      </Card>
    </View>
  );
}

function PaperCard({ brief }: Readonly<{ brief: ExamBrief }>) {
  const anchor = useTourTarget(TOUR_TARGETS.ABOUT_PAPER);

  return (
    <View className="gap-2" {...anchor}>
      <SectionTitle icon={FileText}>The paper</SectionTitle>
      <Card className="gap-3 p-4">
        <InfoRow label="Languages" value={languagesOf(brief)} />
        <InfoRow label="Sectional timing" value={sectionalOf(brief)} />
      </Card>
    </View>
  );
}

function InfoRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text variant="muted">{label}</Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

/** Whether a paper may be started is the tests list's to say, so no answer is given until it has one. */
function Exits({
  testId,
  listed,
  catalog,
  now,
  needsKeyboard,
  journey,
}: Readonly<{
  testId: string;
  journey: ExamBrief['journey'];
  listed: StudentCatalogTest | undefined;
  /** A typing section is typed on a real keyboard, so the paper is not started from a phone. */
  needsKeyboard: boolean;
  catalog: CatalogState;
  now: Date;
}>) {
  if (catalog.isLoading) return <Button loading>Checking your tests</Button>;
  if (catalog.isLoadingError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={catalog.refetch}
      />
    );
  }

  return (
    <Fragment>
      <Proceed testId={testId} listed={listed} now={now} needsKeyboard={needsKeyboard} />
      {journey ? <ExamJourney journey={journey} /> : null}
    </Fragment>
  );
}

function Proceed({
  testId,
  listed,
  now,
  needsKeyboard,
}: Readonly<{
  testId: string;
  listed: StudentCatalogTest | undefined;
  now: Date;
  needsKeyboard: boolean;
}>) {
  const action = listed ? testAction(listed) : null;

  if (!action)
    return <Button disabled>{listed ? shutReason(listed, now) : 'Not open to you'}</Button>;
  if (needsKeyboard) return <Alert variant="info">{NEEDS_KEYBOARD_SAYS}</Alert>;

  return (
    <Fragment>
      {listed && offersRetake(listed) ? <Alert>{RETAKE_SAYS}</Alert> : null}
      <Link href={DETAIL_ROUTES.TEST_INSTRUCTIONS(testId, listed?.liveAttemptId)} asChild>
        <Button
          variant={action === 'RESUME' ? 'warning' : 'default'}
          icon={action === 'RESUME' ? RotateCcw : Play}
        >
          {action === 'RESUME' ? 'Resume test' : 'Proceed to test'}
        </Button>
      </Link>
    </Fragment>
  );
}
