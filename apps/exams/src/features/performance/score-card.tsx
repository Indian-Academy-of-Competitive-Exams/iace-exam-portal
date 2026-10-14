import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, EmptyState, EMPTY_STATE_KINDS, Metric, StatRow, cn } from '@iace/ui';
import { CohortFigure, MarksFigure, TimeFigure } from '@iace/app-kit/browser';
import {
  METRIC_UNITS,
  headlineOf,
  minutes,
  ordinalSuffix,
  targetLabel,
  timeBenchmark,
} from '@iace/app-kit';
import {
  TYPING_PRESETS,
  paperCounts,
  scoreTyping,
  type CohortCurve,
  type ScoreCard,
  type TypingSitting,
} from '@iace/contracts';
import { scoreCardQuery, typingInAttemptQuery } from '../../lib/queries';
import { QualifiedBadge, TypingHeadline, TypingOutcome } from '../typing/typing-result';
import { WRITTEN_NOTICE } from '../typing/written-notice';
import { ScoreCardGate } from './score-card-gate';
import {
  Hero,
  HeroFigure,
  PageBody,
  ReportSkeleton,
  Section,
  StatTile,
  TileGrid,
} from '../../components/ui';

const NO_TYPING: readonly TypingSitting[] = [];

export function ScoreCardPanel() {
  const { attemptId = '' } = useParams();
  const card = useQuery(scoreCardQuery(attemptId));
  // Asked only once the paper is marked: before that it would be refused for the same reason the card is.
  const typing = useQuery({ ...typingInAttemptQuery(attemptId), enabled: card.isSuccess });

  return (
    <ScoreCardGate card={card} failed="Your score card did not load">
      {(data) => {
        // A zero-mark paper is a typing test, so its card waits for the typing rather than showing "0 marks" first.
        if (data.maxMarks === 0 && typing.isPending) return <ReportSkeleton />;
        if (typing.isError) {
          return (
            <EmptyState
              kind={EMPTY_STATE_KINDS.FAILURE}
              title="Your typing result did not load"
              onRetry={() => void typing.refetch()}
            />
          );
        }

        return <Result card={data} typing={typing.data ?? NO_TYPING} />;
      }}
    </ScoreCardGate>
  );
}

function Result({ card, typing }: Readonly<{ card: ScoreCard; typing: readonly TypingSitting[] }>) {
  // A paper that is a typing test alone carries no marks, so its typing is the whole result.
  if (card.maxMarks === 0 && typing.length > 0) {
    return (
      <PageBody>
        {typing.map((sitting) => (
          <TypingSection key={sitting.sectionId} sitting={sitting} leads />
        ))}
      </PageBody>
    );
  }

  const attempted = card.correctCount + card.wrongCount;
  const accuracy = attempted === 0 ? 0 : Math.round((card.correctCount / attempted) * 100);
  // A curve exists only where a cohort drew one; a retake has none to show.
  const curve = card.cohort && card.cohort.bands.length > 0 ? card.cohort : null;
  const counts = paperCounts(card.sections);

  return (
    <PageBody>
      {card.hasWritten ? <Alert variant="info">{WRITTEN_NOTICE}</Alert> : null}
      <Hero
        eyebrow="Your result"
        figure={<Headline card={card} />}
        aside={<Beside card={card} accuracy={accuracy} />}
      />

      <TileGrid className="lg:grid-cols-6 xl:grid-cols-6">
        <StatTile label="Correct" value={card.correctCount} />
        <StatTile label="Wrong" value={card.wrongCount} />
        <StatTile label="Unattempted" value={card.unattemptedCount} />
        <StatTile label="Questions" value={card.totalQuestions} />
        <StatTile label="Percentage" value={card.percentage} unit="%" />
        <StatTile
          label="Time taken"
          value={minutes(card.timeTakenSec)}
          foot={`of ${minutes(card.durationSec)}`}
        />
      </TileGrid>

      <div className={cn('grid items-start gap-4', curve === null ? null : 'lg:grid-cols-2')}>
        {/* Marks and Time read as one column against the crowd standing beside them. */}
        <div className="flex min-w-0 flex-col gap-4">
          <MarksFigure
            composition={card.composition}
            counts={counts}
            benchmark={marksAgainst(curve)}
          />
          <TimeFigure
            time={card.time}
            counts={counts}
            paceIndex={card.paceIndex}
            benchmark={timeBenchmark(card.sections)}
          />
        </div>
        {curve === null ? null : <CohortFigure cohort={curve} />}
      </div>

      {typing.map((sitting) => (
        <TypingSection key={sitting.sectionId} sitting={sitting} />
      ))}
    </PageBody>
  );
}

/** One typing section's result. It leads the page where it is the whole paper, and sits under the marks where it is not. */
function TypingSection({
  sitting,
  leads = false,
}: Readonly<{ sitting: TypingSitting; leads?: boolean }>) {
  const preset = TYPING_PRESETS[sitting.presetKey];
  const result = useMemo(
    () => scoreTyping(sitting.passage, sitting.typed, preset),
    [sitting.passage, sitting.typed, preset],
  );

  return (
    <>
      {leads ? (
        <Hero
          eyebrow={sitting.sectionName}
          figure={<TypingHeadline preset={preset} result={result} />}
          aside={<QualifiedBadge qualified={result.qualified} />}
        />
      ) : (
        <Section title={sitting.sectionName} meta={<QualifiedBadge qualified={result.qualified} />}>
          <Card className="flex flex-col gap-3 p-5">
            <StatRow
              label={`Speed (${METRIC_UNITS[preset.metric]})`}
              value={headlineOf(preset, result).toLocaleString('en-IN')}
            />
            <StatRow label="Target" value={targetLabel(preset)} />
          </Card>
        </Section>
      )}
      <TypingOutcome result={result} />
    </>
  );
}

/** An unranked sitting has no percentile to lead with, so its marks take the headline instead. */
function Headline({ card }: Readonly<{ card: ScoreCard }>) {
  if (card.percentile === null) {
    return <HeroFigure value={card.score} unit={`/ ${card.maxMarks}`} caption="marks" />;
  }
  return (
    <HeroFigure
      value={card.percentile}
      unit={ordinalSuffix(card.percentile)}
      caption={beaten(card)}
    />
  );
}

/** Never the figure twice: what leads the hero is dropped from what stands beside it. */
function Beside({ card, accuracy }: Readonly<{ card: ScoreCard; accuracy: number }>) {
  return (
    <>
      {card.percentile === null ? null : (
        <Metric
          label="Rank"
          value={card.rank ?? '—'}
          unit={
            card.rank === null || card.cohortSize === null ? undefined : `of ${card.cohortSize}`
          }
          size="md"
        />
      )}
      {card.percentile === null ? null : (
        <Metric label="Marks" value={card.score} unit={`/ ${card.maxMarks}`} size="md" />
      )}
      <Metric label="Accuracy" value={accuracy} unit="%" size="md" />
    </>
  );
}

/** The percentile said in people, which is the way a student actually reads it. */
function beaten(card: ScoreCard): string {
  if (card.rank === null || card.cohortSize === null) return 'percentile';
  return `percentile · better than ${card.cohortSize - card.rank} of ${card.cohortSize}`;
}

/** The paper's own marks against the crowd's — the two figures a result is actually read against. */
const marksAgainst = (curve: CohortCurve | null) =>
  curve === null ? undefined : { average: curve.averageScore, topper: curve.topperScore };
