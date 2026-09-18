/// <reference types="nativewind/types" />
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { minutes } from '@iace/app-kit';
import { type MarkComposition, type ScoreCard } from '@iace/contracts';
import { attemptReportQuery, scoreCardQuery } from '../../lib/queries';
import { Card } from '../ui/card';
import { Hero, HeroFigure } from '../ui/hero';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { MeasureBars, type MeasureBar } from '../ui/measure-bars';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';
import { StatTile } from '../ui/stat-tile';

export function ScoreCardPanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const card = useQuery(scoreCardQuery(attemptId));
  const report = useQuery(attemptReportQuery(attemptId));

  const refresh = () => {
    void card.refetch();
    void report.refetch();
  };

  return (
    <RefreshScroll refreshing={card.isRefetching} onRefresh={refresh}>
      {card.isLoading ? <CardSkeleton /> : null}
      {card.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Your score card did not load"
          onRetry={refresh}
        />
      ) : null}
      {card.data ? <Result card={card.data} composition={report.data?.composition} /> : null}
    </RefreshScroll>
  );
}

function Result({
  card,
  composition,
}: Readonly<{ card: ScoreCard; composition: MarkComposition | undefined }>) {
  const attempted = card.correctCount + card.wrongCount;
  const accuracy = attempted === 0 ? 0 : Math.round((card.correctCount / attempted) * 100);

  return (
    <>
      <Headline card={card} />

      <View className="flex-row flex-wrap gap-3">
        {card.percentile === null ? null : <StatTile label="Rank" value={rankOf(card)} />}
        {card.percentile === null ? null : (
          <StatTile label="Marks" value={`${card.score} / ${card.maxMarks}`} />
        )}
        <StatTile label="Accuracy" value={`${accuracy}%`} />
        <StatTile label="Correct" value={card.correctCount} />
        <StatTile label="Wrong" value={card.wrongCount} />
        <StatTile label="Unattempted" value={card.unattemptedCount} />
        <StatTile label="Questions" value={card.totalQuestions} />
        <StatTile label="Percentage" value={`${card.percentage}%`} />
        <StatTile
          label="Time taken"
          value={`${minutes(card.timeTakenSec)} of ${minutes(card.durationSec)}`}
        />
      </View>

      {composition ? <Marks composition={composition} /> : null}
    </>
  );
}

/** An unranked sitting has no percentile to lead with, so its marks take the headline instead. */
function Headline({ card }: Readonly<{ card: ScoreCard }>) {
  const ranked = card.percentile !== null;

  return (
    <Hero eyebrow="Your result">
      <HeroFigure
        value={ranked ? (card.percentile ?? 0) : card.score}
        unit={ranked ? 'th' : `/ ${card.maxMarks}`}
        caption={ranked ? beaten(card) : 'marks'}
      />
    </Hero>
  );
}

/** Where the marks came from and where they leaked — the three shares partition the paper. */
function Marks({ composition }: Readonly<{ composition: MarkComposition }>) {
  const bars: MeasureBar[] = [
    { key: 'earned', label: 'Earned', value: composition.earned, tone: 2 },
    { key: 'wrong', label: 'Lost to wrong', value: composition.lostToWrong, tone: 3 },
    { key: 'blank', label: 'Lost to unanswered', value: composition.lostToUnanswered },
    { key: 'penalty', label: 'Negative marking', value: composition.penalty, tone: 3 },
  ];

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">Marks</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={composition.maxMarks} />
      </Card>
    </View>
  );
}

const rankOf = (card: ScoreCard) =>
  card.rank === null ? '—' : `${card.rank} of ${card.cohortSize ?? '—'}`;

/** The percentile said in people, which is the way a student actually reads it. */
function beaten(card: ScoreCard): string {
  if (card.rank === null || card.cohortSize === null) return 'percentile';
  return `percentile · better than ${card.cohortSize - card.rank} of ${card.cohortSize}`;
}

export function CardSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </View>
  );
}
