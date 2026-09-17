/// <reference types="nativewind/types" />
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { minutes } from '@iace/app-kit';
import { type PerformanceReport, type SectionalStanding } from '@iace/contracts';
import { attemptReportQuery } from '../../lib/queries';
import { plural } from '../../lib/plural';
import { Badge, type BadgeVariant } from '../ui/badge';
import { Card } from '../ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { MeasureBars, type MeasureBar } from '../ui/measure-bars';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';

const DASH = '—';

/** Where a section stands against the field. A cutoff would be a line; this is a position. */
const STANDINGS: Readonly<Record<string, { label: string; variant: BadgeVariant }>> = {
  ABOVE: { label: 'Above average', variant: 'success' },
  LEVEL: { label: 'At average', variant: 'neutral' },
  BELOW: { label: 'Below average', variant: 'warning' },
  NONE: { label: DASH, variant: 'neutral' },
};

export function SubjectsPanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const report = useQuery(attemptReportQuery(attemptId));
  const refresh = () => void report.refetch();

  return (
    <RefreshScroll refreshing={report.isRefetching} onRefresh={refresh}>
      {report.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {report.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This subject report did not load"
          onRetry={refresh}
        />
      ) : null}
      {report.data ? <Sections report={report.data} /> : null}
    </RefreshScroll>
  );
}

function Sections({ report }: Readonly<{ report: PerformanceReport }>) {
  if (report.sections.length === 0) {
    return <EmptyState title="No sections" />;
  }

  return (
    <>
      <Text className="text-sm text-muted-foreground">
        {plural(report.sections.length, 'section')}
      </Text>
      {report.sections.map((section) => (
        <Section key={section.baseConfigSectionId} section={section} />
      ))}
      <Spread sections={report.sections} />
    </>
  );
}

function Section({ section }: Readonly<{ section: SectionalStanding }>) {
  const standing = standingOf(section);

  return (
    <Card className="gap-3 p-5">
      <View className="gap-2">
        <Text className="text-lg font-semibold text-foreground" numberOfLines={2}>
          {section.name}
        </Text>
        <Badge variant={standing.variant}>{standing.label}</Badge>
      </View>

      <View className="flex-row items-baseline gap-1">
        <Text className="text-2xl font-bold tracking-tight text-foreground">{section.score}</Text>
        <Text className="text-sm text-muted-foreground">{`of ${section.maxMarks} marks`}</Text>
      </View>

      <View className="flex-row flex-wrap gap-x-5 gap-y-1">
        <Figure label="Correct" value={section.correctCount} />
        <Figure label="Wrong" value={section.wrongCount} />
        <Figure label="Unattempted" value={section.unattemptedCount} />
      </View>

      <View className="gap-1 border-t border-border pt-3">
        <Figure label="Your time" value={minutes(section.timeSpentSec)} />
        <Figure label="Average time" value={minutes(section.cohortAverageTimeSec)} />
        <Figure label="Topper time" value={minutes(section.topperTimeSec)} />
      </View>
    </Card>
  );
}

function Figure({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <View className="flex-row items-baseline gap-2">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

/** Every section on one scale of marks, which is the comparison a column of cards cannot make. */
function Spread({ sections }: Readonly<{ sections: readonly SectionalStanding[] }>) {
  const max = Math.max(...sections.map((section) => section.maxMarks), 1);
  const bars: MeasureBar[] = sections.map((section) => ({
    key: section.baseConfigSectionId,
    label: section.name,
    value: section.score,
    display: `${section.score} / ${section.maxMarks}`,
    meta: section.cohortAverageScore === null ? undefined : `avg ${section.cohortAverageScore}`,
    tone: 2,
  }));

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">Marks by section</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={max} />
      </Card>
    </View>
  );
}

function standingOf(section: SectionalStanding) {
  if (section.cohortAverageScore === null) return STANDINGS.NONE;
  if (section.score > section.cohortAverageScore) return STANDINGS.ABOVE;
  return section.score < section.cohortAverageScore ? STANDINGS.BELOW : STANDINGS.LEVEL;
}
