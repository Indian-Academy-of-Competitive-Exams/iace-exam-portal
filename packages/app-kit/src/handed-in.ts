/** What a handed-in paper says before it is marked: its own effort, and who that effort stands beside. */
import { type FieldEffort, type SectionEffort, type SectionEffortFigure } from '@iace/contracts';

export const EFFORT_RUNNERS = {
  YOU: 'you',
  PREVIOUS: 'previous',
  TOPPER: 'topper',
  FIELD: 'field',
} as const;

export type EffortRunner = (typeof EFFORT_RUNNERS)[keyof typeof EFFORT_RUNNERS];

const RUNNER_LABELS = {
  [EFFORT_RUNNERS.YOU]: 'You',
  [EFFORT_RUNNERS.PREVIOUS]: 'Last attempt',
  [EFFORT_RUNNERS.TOPPER]: 'Topper',
  [EFFORT_RUNNERS.FIELD]: 'Field average',
} as const satisfies Record<EffortRunner, string>;

/** Ranked sittings an average needs behind it before it is read as the field's rather than a few people's. */
export const FIELD_SAMPLE_FLOOR = 10;

export interface EffortReading {
  runner: EffortRunner;
  label: string;
  attempted: number;
  timeSpentSec: number;
  /** An average over too few to stand beside the rest: drawn, but as a wash. */
  faint: boolean;
}

type Effort = Pick<SectionEffortFigure, 'attempted' | 'timeSpentSec'>;

const reading = (runner: EffortRunner, effort: Effort, faint = false): EffortReading => ({
  runner,
  label: RUNNER_LABELS[runner],
  attempted: effort.attempted,
  timeSpentSec: effort.timeSpentSec,
  faint,
});

const isThin = (field: FieldEffort | undefined): boolean =>
  (field?.cohortSize ?? 0) < FIELD_SAMPLE_FLOOR;

/** One section across everyone it can stand beside, in reading order. A runner with no figure is left out. */
export function sectionReadings(
  section: SectionEffort,
  field: FieldEffort | undefined,
): EffortReading[] {
  const beside = (
    runner: EffortRunner,
    figures: readonly SectionEffortFigure[] | null | undefined,
    faint = false,
  ): EffortReading[] => {
    const held = figures?.find((row) => row.baseConfigSectionId === section.id);
    return held ? [reading(runner, held, faint)] : [];
  };

  return [
    reading(EFFORT_RUNNERS.YOU, section),
    ...beside(EFFORT_RUNNERS.PREVIOUS, field?.previous),
    ...beside(EFFORT_RUNNERS.TOPPER, field?.topper),
    ...beside(EFFORT_RUNNERS.FIELD, field?.average, isThin(field)),
  ];
}

export interface PaperEffort {
  total: number;
  attempted: number;
  timeSpentSec: number;
}

export function paperEffort(sections: readonly SectionEffort[]): PaperEffort {
  return sections.reduce<PaperEffort>(
    (paper, section) => ({
      total: paper.total + section.total,
      attempted: paper.attempted + section.attempted,
      timeSpentSec: paper.timeSpentSec + section.timeSpentSec,
    }),
    { total: 0, attempted: 0, timeSpentSec: 0 },
  );
}

/** Null where there is nobody to add up, so an absent runner is never read as one who answered nothing. */
function attemptedBy(figures: readonly SectionEffortFigure[] | null | undefined): number | null {
  if (!figures || figures.length === 0) return null;
  return figures.reduce((sum, row) => sum + row.attempted, 0);
}

/** The strongest thing that is TRUE of the effort. No mark is known here, and none is implied. */
export function effortLine(
  sections: readonly SectionEffort[],
  field: FieldEffort | undefined,
): string {
  const mine = paperEffort(sections);

  const before = attemptedBy(field?.previous);
  if (before !== null && mine.attempted > before) {
    return `${mine.attempted - before} more attempted than your last attempt`;
  }
  if (mine.total > 0 && mine.attempted === mine.total) return 'Every question attempted';

  // A handful of early sittings is not a field, and being above them is not worth saying.
  const average = isThin(field) ? null : attemptedBy(field?.average);
  if (average !== null && mine.attempted > average) return 'Attempted, above the field average';
  return 'Attempted';
}
