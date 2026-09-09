import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import {
  EVALUATION_MODE,
  ITEM_SIGNALS,
  SYSTEM_DIFFICULTY,
  distractorThatWon,
  percentLabel,
  systemDifficultyOf,
  worthInspecting,
  type ItemSignal,
  type TestAnalytics,
  type TestItemAnalytics,
  type TestSectionAnalytics,
} from '@iace/contracts';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  ChartFigure,
  DataTable,
  DistributionPlot,
  EmptyState,
  MeasureBars,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  SkeletonParagraph,
  StatRow,
  TruncatedText,
  plural,
  type DataTableColumn,
  type DistributionMarker,
  type MeasureBar,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { durationLabel, secondsLabel } from '../lib/duration';

const DASH = '—';
const UNTITLED = 'Untitled test';
const PLOT_HEIGHT = 260;
const PERCENT = 100;

/** The cohort's verdict on an item, on the same three bands the student report reads. */
const DIFFICULTY_TONES = {
  [SYSTEM_DIFFICULTY.EASY]: 'success',
  [SYSTEM_DIFFICULTY.MEDIUM]: 'warning',
  [SYSTEM_DIFFICULTY.HARD]: 'danger',
} as const;

const ITEM_SIGNAL_LABELS = {
  [ITEM_SIGNALS.LOW_ACCURACY]: 'Below chance',
  [ITEM_SIGNALS.HIGH_SKIP]: 'Mostly left blank',
  [ITEM_SIGNALS.SLOW]: 'Twice the paper average',
  [ITEM_SIGNALS.NEGATIVE_DISCRIMINATION]: 'Negative discrimination',
} as const satisfies Record<ItemSignal, string>;

/** How a test performed across the cohort that sat it, off the rollups folded at scoring time. */
export function TestAnalyticsPage() {
  const { id = '' } = useParams();

  const analytics = useQuery({
    queryKey: [...QUERY_KEYS.TEST_ANALYTICS, id],
    queryFn: () => api.admin.tests.analytics(id),
  });

  if (analytics.isPending) {
    return (
      <PageFrame>
        <div className="flex flex-col gap-5">
          <Skeleton variant="title" />
          <SkeletonParagraph lines={6} />
        </div>
      </PageFrame>
    );
  }
  if (analytics.error || !analytics.data) {
    return (
      <PageFrame>
        <Alert variant="danger">Could not load this test&apos;s results.</Alert>
      </PageFrame>
    );
  }

  const report = analytics.data;
  const title = report.title ?? UNTITLED;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[{ label: title, to: ROUTES.TEST(id) }, { label: 'Analytics' }]}
            />
          }
          title={title}
          meta={`${plural(report.summary.evaluatedCount, 'ranked sitting')} of ${plural(
            report.summary.attemptCount,
            'sitting',
          )}`}
        />
      }
    >
      <Body report={report} />
    </PageFrame>
  );
}

function Body({ report }: Readonly<{ report: TestAnalytics }>) {
  const { summary, sections, items } = report;
  const flagged = items.filter((item) => worthInspecting(item)).length;

  if (summary.evaluatedCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        {report.evaluationMode === EVALUATION_MODE.RANKED ? null : (
          /* ui-copy-ok: rule */
          <Alert variant="info">
            Only a student&apos;s first ranked sitting folds into these figures, and this test is
            not ranked.
          </Alert>
        )}
        <EmptyState icon={BarChart3} title="No ranked results folded yet" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Spread summary={summary} />
      <Sections sections={sections} />
      <Items items={items} flagged={flagged} />
    </div>
  );
}

function Spread({ summary }: Readonly<{ summary: TestAnalytics['summary'] }>) {
  const markers: DistributionMarker[] = [];
  if (summary.meanScore !== null) {
    markers.push({ key: 'mean', label: 'Mean', value: summary.meanScore, tone: 'you' });
  }
  if (summary.topper !== null && summary.topper.score !== null) {
    markers.push({ key: 'topper', label: 'Topper', value: summary.topper.score, tone: 'good' });
  }
  const floor = summary.bands[0]?.from ?? summary.minScore ?? 0;
  const ceiling = summary.bands.at(-1)?.to ?? summary.maxScore ?? 0;

  return (
    <ChartFigure
      title="Score spread"
      meta={plural(summary.evaluatedCount, 'ranked sitting')}
      figure={<Metric size="md" label="Mean" value={summary.meanScore ?? DASH} unit="marks" />}
    >
      <DistributionPlot
        height={PLOT_HEIGHT}
        bands={summary.bands}
        markers={markers}
        min={floor}
        max={ceiling}
        axisSuffix="marks"
        countLabel="Sittings"
        aria-label="How the cohort's scores were spread across the paper"
      />
      <MetricGroup>
        <Metric size="sm" label="Highest" value={summary.maxScore ?? DASH} />
        <Metric size="sm" label="Lowest" value={summary.minScore ?? DASH} />
        <Metric size="sm" label="Median (approximate)" value={summary.medianScore ?? DASH} />
        <Metric size="sm" label="Average time" value={durationLabel(summary.averageTimeSec)} />
      </MetricGroup>
      {summary.topper === null ? null : (
        <div className="border-t border-border pt-3">
          <StatRow label="Topper" value={topperValue(summary.topper)} />
        </div>
      )}
    </ChartFigure>
  );
}

function topperValue(topper: NonNullable<TestAnalytics['summary']['topper']>): string {
  const score = topper.score === null ? DASH : `${topper.score} marks`;
  return `${topper.name} · ${score} · ${durationLabel(topper.timeSpentSec)}`;
}

/** Marks as a share of what the section was out of, so a 25-mark section reads beside a 100. */
function Sections({ sections }: Readonly<{ sections: readonly TestSectionAnalytics[] }>) {
  const bars: MeasureBar[] = sections.map((section) => ({
    key: section.baseConfigSectionId,
    label: section.name,
    value: shareOf(section),
    display: `${section.averageScore ?? DASH} / ${section.maxMarks}`,
    meta: `${plural(section.attempted, 'sitting')} · ${durationLabel(section.averageTimeSec)}`,
  }));

  return (
    <ChartFigure title="Section averages" meta={plural(sections.length, 'section')}>
      {bars.length === 0 ? (
        <EmptyState icon={BarChart3} title="No sections folded yet" level={3} />
      ) : (
        <MeasureBars bars={bars} max={PERCENT} />
      )}
    </ChartFigure>
  );
}

function shareOf(section: TestSectionAnalytics): number {
  if (section.averageScore === null || section.maxMarks === 0) return 0;
  return (section.averageScore / section.maxMarks) * PERCENT;
}

function Items({
  items,
  flagged,
}: Readonly<{ items: readonly TestItemAnalytics[]; flagged: number }>) {
  const columns = useMemo(() => itemColumns(items), [items]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title="Questions" meta={plural(items.length, 'question')} />
      {flagged === 0 ? null : (
        <Alert variant="warning">
          {plural(flagged, 'question')} tripped two or more of the item signals — open a flagged row
          to see which.
        </Alert>
      )}
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(item) => item.paperQuestionId}
        isLoading={false}
        empty="No questions folded yet."
        expand={{
          label: (item) => `Option spread for question ${item.order}`,
          render: (item) => <ItemPanel item={item} />,
        }}
      />
    </section>
  );
}

function itemColumns(items: readonly TestItemAnalytics[]): DataTableColumn<TestItemAnalytics>[] {
  const columns: DataTableColumn<TestItemAnalytics>[] = [
    { key: 'order', header: '#', numeric: true, cell: (item) => item.order },
    {
      key: 'code',
      header: 'Code',
      className: 'max-w-[8rem]',
      cell: (item) => <TruncatedText>{item.questionCode}</TruncatedText>,
    },
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-[22rem]',
      cell: (item) => <TruncatedText>{item.stemPreview}</TruncatedText>,
    },
    { key: 'attempted', header: 'Attempted', numeric: true, cell: (item) => item.attemptedCount },
    { key: 'correct', header: 'Correct', numeric: true, cell: (item) => item.correctCount },
    { key: 'wrong', header: 'Wrong', numeric: true, cell: (item) => item.wrongCount },
    { key: 'skipped', header: 'Blank', numeric: true, cell: (item) => item.skippedCount },
    {
      key: 'time',
      header: 'Average time',
      numeric: true,
      cell: (item) => secondsLabel(item.averageTimeSec),
    },
    {
      key: 'accuracy',
      header: 'Accuracy',
      numeric: true,
      cell: (item) => percentLabel(asPercent(item.pValue), DASH),
    },
    {
      key: 'difficulty',
      header: 'Actual difficulty',
      cell: (item) => <DifficultyBadge item={item} />,
    },
  ];

  if (items.some((item) => item.discrimination !== null)) {
    columns.push({
      key: 'discrimination',
      header: 'Discrimination',
      numeric: true,
      cell: (item) => item.discrimination ?? DASH,
    });
  }

  columns.push({
    key: 'inspect',
    header: 'Inspect',
    cell: (item) =>
      worthInspecting(item) ? <Badge variant="danger">{item.signals.length} signals</Badge> : null,
  });
  return columns;
}

function DifficultyBadge({ item }: Readonly<{ item: TestItemAnalytics }>) {
  const band = systemDifficultyOf(item.pValue);
  if (band === null) return <>{DASH}</>;
  return <Badge variant={DIFFICULTY_TONES[band]}>{band}</Badge>;
}

/** How the cohort split across the options, and what the item tripped. */
function ItemPanel({ item }: Readonly<{ item: TestItemAnalytics }>) {
  const total = item.optionCounts.reduce((sum, option) => sum + option.count, 0);
  const bars: MeasureBar[] = item.optionCounts.map((option) => ({
    key: option.optionId,
    label: `Option ${option.position}${option.isCorrect ? ' — correct' : ''}`,
    value: option.count,
    tone: option.isCorrect ? 2 : 1,
  }));
  const won = distractorThatWon(item);

  return (
    <div className="flex flex-col gap-3">
      {bars.length === 0 ? (
        <StatRow label="Option spread" value={DASH} />
      ) : (
        <MeasureBars bars={bars} max={total} />
      )}
      {won === null || won.isCorrect ? null : (
        <Alert variant="warning">
          Option {won.position} pulled {won.count} of {total} — the same wrong answer most of the
          field reached for.
        </Alert>
      )}
      {item.signals.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {item.signals.map((signal) => (
            <Badge key={signal} variant="warning">
              {ITEM_SIGNAL_LABELS[signal]}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const asPercent = (ratio: number | null) => (ratio === null ? null : ratio * PERCENT);
