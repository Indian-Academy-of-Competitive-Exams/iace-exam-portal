/**
 * The moment after a paper is handed in: the sitting's own effort, section by section, beside the
 * field's. Nothing here is a mark, so nothing here waits on marking; the result is the last step.
 */
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { usePrefetchQuery, useQuery } from '@tanstack/react-query';
import {
  Button,
  ChartFigure,
  MeasureBars,
  Metric,
  PageFrame,
  PageHeader,
  plural,
  type MeasureBar,
} from '@iace/ui';
import {
  EFFORT_RUNNERS,
  effortLine,
  minutes,
  paperEffort,
  sectionReadings,
  type EffortReading,
  type EndedSitting,
} from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import { type FieldEffort, type SectionEffort } from '@iace/contracts';
import { Hero, HeroFigure, PageBody, Section } from '../../components/ui';
import { NAV_ITEMS, ROUTES } from '../../lib/constants';
import { fieldEffortQuery, scoreCardAheadQuery } from '../../lib/queries';

/** One hue a runner, the same on every figure, so a bar is recognised before its label is read. */
const RUNNER_TONES = {
  [EFFORT_RUNNERS.YOU]: 1,
  [EFFORT_RUNNERS.TOPPER]: 2,
  [EFFORT_RUNNERS.FIELD]: 3,
  [EFFORT_RUNNERS.PREVIOUS]: 4,
} as const;

export function SubmittedPage() {
  const { attemptId = '' } = useParams();
  const handedIn = useLocation().state as EndedSitting | null;
  const field = useQuery(fieldEffortQuery(attemptId));
  // Asked for while the student reads, so the result is already held when they reach the button.
  usePrefetchQuery(scoreCardAheadQuery(attemptId));

  // Reached without the sitting's own summary — a reload, an old link: the result is all there is.
  if (!handedIn) return <Navigate to={ROUTES.REPORT(attemptId)} replace />;

  const paper = paperEffort(handedIn.sections);
  const cohortSize = field.data?.cohortSize ?? 0;

  return (
    <PageFrame
      header={
        <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} size="display" title="Handed in" />
      }
    >
      <PageBody>
        <Hero
          eyebrow="Your paper"
          figure={
            <HeroFigure
              value={paper.attempted}
              unit={`/ ${paper.total}`}
              caption={effortLine(handedIn.sections, field.data)}
            />
          }
          aside={
            <>
              <Metric label="Time spent" value={minutes(paper.timeSpentSec)} size="md" />
              {cohortSize > 0 ? (
                <Metric label="Candidates ranked" value={cohortSize} size="md" />
              ) : null}
            </>
          }
        />

        {handedIn.sections.map((section) => (
          <SectionEffortFigures key={section.id} section={section} field={field.data} />
        ))}

        <div className="flex justify-end">
          <Button asChild className="w-full sm:w-auto">
            <Link to={ROUTES.REPORT(attemptId)}>See your result</Link>
          </Button>
        </div>
      </PageBody>
    </PageFrame>
  );
}

/** One section: how much of it was answered and how long it took, beside whoever it can stand beside. */
function SectionEffortFigures({
  section,
  field,
}: Readonly<{ section: SectionEffort; field: FieldEffort | undefined }>) {
  const readings = sectionReadings(section, field);

  return (
    <Section title={section.name} meta={plural(section.total, 'question')}>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartFigure title="Attempted">
          <MeasureBars bars={readings.map(attemptedBar)} max={section.total} />
        </ChartFigure>
        <ChartFigure title="Time">
          <MeasureBars bars={readings.map(timeBar)} max={0} />
        </ChartFigure>
      </div>
    </Section>
  );
}

/** A mean is rarely whole, so it is read to one decimal; a whole count never grows a `.0`. */
const countLabel = (count: number) => String(Math.round(count * 10) / 10);

const attemptedBar = (reading: EffortReading): MeasureBar => ({
  key: reading.runner,
  label: reading.label,
  value: reading.attempted,
  display: countLabel(reading.attempted),
  faint: reading.faint,
  tone: RUNNER_TONES[reading.runner],
});

const timeBar = (reading: EffortReading): MeasureBar => ({
  key: reading.runner,
  label: reading.label,
  value: reading.timeSpentSec,
  display: minutes(reading.timeSpentSec),
  faint: reading.faint,
  tone: RUNNER_TONES[reading.runner],
});
