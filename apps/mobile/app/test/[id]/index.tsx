/**
 * What a student reads BEFORE the clock starts — ported from the web's `test-about.tsx`. Past
 * attempts are dropped: they link to a score-card route this slice does not build yet.
 */
import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { shutReason } from '@iace/app-kit';
import {
  contentLanguageOf,
  instituteDateTimeLabel,
  LANGUAGE_LABELS,
  LANGUAGE_MODE,
  TEST_BUCKET,
  testAction,
  testBucket,
  type ExamBrief,
  type LanguageCode,
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
import { DETAIL_ROUTES } from '../../../src/lib/nav';
import { cn } from '../../../src/lib/cn';
import { TourTrigger, usePageTour, useTourTarget } from '../../../src/lib/page-tour';
import { TEST_ABOUT_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../../src/lib/tours';
import { plural } from '../../../src/lib/plural';

type Phase = 'LOADING' | 'ERROR' | 'READY';

function phaseOf(brief: { isLoading: boolean; isError: boolean }): Phase {
  if (brief.isLoading) return 'LOADING';
  if (brief.isError) return 'ERROR';
  return 'READY';
}

/** A stable render prop for the navigator's headerRight, rather than a closure rebuilt each render. */
const renderTourTrigger = () => <TourTrigger />;

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
  now,
}: Readonly<{
  phase: Phase;
  brief: ExamBrief | undefined;
  onRetry: () => void;
  testId: string;
  seriesName: string | undefined;
  listed: StudentCatalogTest | undefined;
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
        {listed ? (
          <Text variant="muted">
            Opens {listed.opensAt === null ? 'any time' : instituteDateTimeLabel(listed.opensAt)}
          </Text>
        ) : null}
      </View>

      {listed ? <ShutNotice test={listed} /> : null}

      <View {...band}>
        <StatTileRow>
          <StatTile label="Questions" value={brief.totalQuestions} />
          <StatTile label="Duration" value={`${Math.round(brief.durationSec / 60)} min`} />
          <StatTile label="Total marks" value={totalMarksOf(brief)} />
          <StatTile label="Negative" value={negativeOf(brief)} />
        </StatTileRow>
      </View>

      <SectionsCard brief={brief} />
      <PaperCard brief={brief} />

      <Exits testId={testId} listed={listed} now={now} />
    </Fragment>
  );
}

/** Not open YET is a consequence, so it is an Alert — nothing else can keep a paper shut. */
function ShutNotice({ test }: Readonly<{ test: StudentCatalogTest }>) {
  const bucket = testBucket(test);
  if (bucket === TEST_BUCKET.OPEN || bucket === TEST_BUCKET.DONE) return null;
  return <Alert>This paper has not opened yet. Nothing can be started until it does.</Alert>;
}

function SectionsCard({ brief }: Readonly<{ brief: ExamBrief }>) {
  const anchor = useTourTarget(TOUR_TARGETS.ABOUT_SECTIONS);

  return (
    <View className="gap-2" {...anchor}>
      <View className="flex-row items-baseline justify-between">
        <Text variant="section">Sections</Text>
        <Text variant="muted">{plural(brief.sections.length, 'section')}</Text>
      </View>
      <Card>
        {brief.sections.map((section, index) => (
          <View key={section.id} className={cn('gap-1 p-4', index > 0 && 'border-t border-border')}>
            <View className="flex-row items-center justify-between gap-2">
              <Text numberOfLines={1} className="flex-1 text-sm font-medium text-foreground">
                {section.name}
              </Text>
              <Text variant="subsection">{sectionMarks(section)} marks</Text>
            </View>
            <Text variant="meta">{sectionLine(section)}</Text>
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
      <Text variant="section">The paper</Text>
      <Card className="gap-3 p-4">
        <InfoRow label="Languages" value={languagesOf(brief)} />
        <InfoRow label="Sectional timing" value={sectionalOf(brief) ? 'Yes' : 'No'} />
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

function Exits({
  testId,
  listed,
  now,
}: Readonly<{ testId: string; listed: StudentCatalogTest | undefined; now: Date }>) {
  const action = listed ? testAction(listed) : null;

  if (!action) {
    return <Button disabled>{listed ? shutReason(listed, now) : 'Not open to you'}</Button>;
  }

  return (
    <Link href={DETAIL_ROUTES.TEST_INSTRUCTIONS(testId)} asChild>
      <Button>{action === 'RESUME' ? 'Resume test' : 'Proceed to test'}</Button>
    </Link>
  );
}

const round = (value: number) => Math.round(value * 100) / 100;

const totalMarksOf = (brief: ExamBrief) =>
  round(
    brief.sections.reduce(
      (sum, section) => sum + section.questionCount * section.marksPerQuestion,
      0,
    ),
  );

/** One figure where every section agrees, and a range where they do not — never a wrong single one. */
function negativeOf(brief: ExamBrief): string {
  const values = [...new Set(brief.sections.map((section) => section.negativeMarks))].sort(
    (a, b) => a - b,
  );
  if (values.length === 0) return '—';
  if (values.length === 1) return `−${values[0]}`;
  return `−${values[0]} to −${values.at(-1)}`;
}

const languagesOf = (brief: ExamBrief) => {
  const named = brief.languages
    .map((code: LanguageCode) => LANGUAGE_LABELS[contentLanguageOf(code)])
    .join(', ');
  return brief.languageMode === LANGUAGE_MODE.DUAL ? `${named} (side by side)` : named;
};

const sectionalOf = (brief: ExamBrief) =>
  brief.sections.some((section) => section.durationSec !== null);

const sectionMarks = (section: ExamBrief['sections'][number]) =>
  round(section.questionCount * section.marksPerQuestion);

function sectionLine(section: ExamBrief['sections'][number]): string {
  const clock = section.durationSec === null ? null : `${Math.round(section.durationSec / 60)} min`;
  return [
    plural(section.questionCount, 'question'),
    `+${section.marksPerQuestion} / −${section.negativeMarks}`,
    clock,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}
