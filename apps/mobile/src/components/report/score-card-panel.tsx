/// <reference types="nativewind/types" />
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  METRIC_UNITS,
  headlineOf,
  isMarkingPending,
  NO_MARKS_YET,
  REPORT_FAILED,
  WRITTEN_NOTICE,
  minutes,
  mistakesOf,
  timeBenchmark,
  ordinalSuffix,
  targetLabel,
} from '@iace/app-kit';
import {
  TYPING_PRESETS,
  paperCounts,
  scoreTyping,
  type MarkComposition,
  type ScoreCard,
  type TypingSitting,
} from '@iace/contracts';
import { scoreCardQuery, typingInAttemptQuery } from '../../lib/queries';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Hero, HeroFigure } from '../ui/hero';
import { EmptyState } from '../ui/empty-state';
import { EMPTY_STATE_KINDS } from '../ui/empty-state-kinds';
import { MeasureBars, type MeasureBar } from '../ui/measure-bars';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';
import { StatTile, StatTileRow } from '../ui/stat-tile';
import { CohortFigure, TimeFigure } from './score-card-figures';
import ChartColumn from 'lucide-react-native/icons/chart-column';
import { SectionTitle } from '../ui/section-title';

export function ScoreCardPanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const card = useQuery(scoreCardQuery(attemptId));
  // Asked only once the paper is marked: before that it would be refused for the same reason the card is.
  const typing = useQuery({ ...typingInAttemptQuery(attemptId), enabled: card.isSuccess });

  const refresh = () => void card.refetch();

  return (
    <RefreshScroll refreshing={card.isRefetching} onRefresh={refresh}>
      {card.isLoading ? <CardSkeleton /> : null}
      {isMarkingPending(card.error) ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.EMPTY}
          title={NO_MARKS_YET.title}
          // ui-copy-ok: consequence
          hint={NO_MARKS_YET.hint}
          onRetry={refresh}
        />
      ) : null}
      {card.isLoadingError && !isMarkingPending(card.error) ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title={REPORT_FAILED.scoreCard}
          onRetry={refresh}
        />
      ) : null}
      {card.data ? <Result card={card.data} typing={typing.data ?? NO_TYPING} /> : null}
    </RefreshScroll>
  );
}

const NO_TYPING: readonly TypingSitting[] = [];

function Result({ card, typing }: Readonly<{ card: ScoreCard; typing: readonly TypingSitting[] }>) {
  // A paper that is a typing test alone carries no marks, so its typing is the whole result.
  if (card.maxMarks === 0 && typing.length > 0) {
    return (
      <>
        {typing.map((sitting) => (
          <TypingResult key={sitting.sectionId} sitting={sitting} />
        ))}
      </>
    );
  }

  const attempted = card.correctCount + card.wrongCount;
  const accuracy = attempted === 0 ? 0 : Math.round((card.correctCount / attempted) * 100);

  // A curve exists only where a cohort drew one; a retake has none to show.
  const curve = card.cohort && card.cohort.bands.length > 0 ? card.cohort : null;
  const counts = paperCounts(card.sections);

  return (
    <>
      {card.hasWritten ? <Alert variant="info">{WRITTEN_NOTICE}</Alert> : null}
      <Headline card={card} />

      <StatTileRow>
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
      </StatTileRow>

      <Marks composition={card.composition} />
      <TimeFigure
        time={card.time}
        counts={counts}
        paceIndex={card.paceIndex}
        benchmark={timeBenchmark(card.sections)}
      />
      {curve === null ? null : <CohortFigure cohort={curve} />}

      {typing.map((sitting) => (
        <TypingResult key={sitting.sectionId} sitting={sitting} />
      ))}
    </>
  );
}

/** One typing section: the figure its standard is held to, whether it qualified, and what it came to. */
function TypingResult({ sitting }: Readonly<{ sitting: TypingSitting }>) {
  const preset = TYPING_PRESETS[sitting.presetKey];
  const result = scoreTyping(sitting.passage, sitting.typed, preset);

  return (
    <>
      <Hero eyebrow={sitting.sectionName}>
        <HeroFigure
          value={headlineOf(preset, result).toLocaleString('en-IN')}
          unit={METRIC_UNITS[preset.metric]}
          caption={`Target ${targetLabel(preset)}`}
        />
        <Badge variant={result.qualified ? 'success' : 'danger'}>
          {result.qualified ? 'Qualified' : 'Not qualified'}
        </Badge>
      </Hero>
      <StatTileRow>
        <StatTile label="Key depressions" value={result.keyDepressions.toLocaleString('en-IN')} />
        <StatTile label="Mistakes" value={mistakesOf(result)} />
        <StatTile label="Errors" value={`${result.errorPct}%`} />
      </StatTileRow>
    </>
  );
}

/** An unranked sitting has no percentile to lead with, so its marks take the headline instead. */
function Headline({ card }: Readonly<{ card: ScoreCard }>) {
  const { percentile } = card;
  const ranked = percentile !== null;

  return (
    <Hero eyebrow="Your result">
      <HeroFigure
        value={ranked ? percentile : card.score}
        unit={ranked ? ordinalSuffix(percentile) : `/ ${card.maxMarks}`}
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
      <SectionTitle icon={ChartColumn}>Marks</SectionTitle>
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

function CardSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </View>
  );
}
