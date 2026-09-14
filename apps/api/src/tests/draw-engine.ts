import { DIFFICULTY_LEVELS, type DifficultyLevel, type SectionDrawSpec } from '@iace/contracts';
import { seededRandom, shuffle } from '../common/seeded-shuffle';

/** The ONE draw. Pure: it is handed a pool and returns a section's rows, so it needs no database. */

/** A question as the draw reads it — the columns that decide, and the version it would pin. */
export interface DrawCandidate {
  id: string;
  currentVersionId: string;
  subjectId: string;
  topicId: string | null;
  difficulty: DifficultyLevel;
  tags: readonly string[];
}

/** A config section in the form the draw judges it: how many, of what, worth what. */
export interface DrawSection {
  id: string;
  name: string;
  subjectId: string | null;
  questionCount: number;
  marksPerQuestion: number;
  negativeMarks: number;
}

/** One row of the paper. Marks come from the SECTION, the version from the QUESTION. */
export interface DrawnQuestion {
  baseConfigSectionId: string;
  questionId: string;
  questionVersionId: string;
  order: number;
  marks: number;
  negativeMarks: number;
}

export interface SectionShortfall {
  baseConfigSectionId: string;
  sectionName: string;
  needed: number;
  available: number;
}

/** The section's rows or the reason there aren't enough — never a short section that reads as whole. */
export type DrawResult =
  { ok: true; questions: DrawnQuestion[] } | { ok: false; shortfall: SectionShortfall };

export interface DrawRequest {
  section: DrawSection;
  pool: readonly DrawCandidate[];
  /** What the section draws from: its topics, its tags, and how many of each difficulty. */
  spec?: SectionDrawSpec;
  /** Same seed, same pool, same rows — which is what makes a re-draw a decision, not a dice roll. */
  seed: number;
  /** Chosen by hand, already resolved against the bank. The draw fills what is left. */
  pins?: readonly DrawCandidate[];
}

/** Fills the section to its exact count, pins first, or says how short the pool left it. */
export function drawSection({ section, pool, spec, seed, pins = [] }: DrawRequest): DrawResult {
  const pinned = new Set(pins.map((pin) => pin.id));
  // Sorted by id first, so the SEED decides the paper and not the order the rows arrived in.
  const eligible = shuffle([...pool].sort(byId), seededRandom(seed)).filter(
    (candidate) => !pinned.has(candidate.id) && matches(candidate, section, spec),
  );
  const taken = [...pins, ...fill(section, spec, pins, eligible)];

  if (taken.length < section.questionCount) {
    return {
      ok: false,
      shortfall: {
        baseConfigSectionId: section.id,
        sectionName: section.name,
        needed: section.questionCount,
        available: taken.length,
      },
    };
  }

  return {
    ok: true,
    questions: taken.map((candidate, index) => ({
      baseConfigSectionId: section.id,
      questionId: candidate.id,
      questionVersionId: candidate.currentVersionId,
      order: index + 1,
      marks: section.marksPerQuestion,
      negativeMarks: section.negativeMarks,
    })),
  };
}

/** Each difficulty to its own count, and a pin is counted against the bucket it belongs to. */
function fill(
  section: DrawSection,
  spec: SectionDrawSpec | undefined,
  chosen: readonly DrawCandidate[],
  eligible: readonly DrawCandidate[],
): DrawCandidate[] {
  if (!spec?.mix) {
    return eligible.slice(0, Math.max(0, section.questionCount - chosen.length));
  }

  const mix = spec.mix;
  return DIFFICULTY_LEVELS.flatMap((level) => {
    const pinned = chosen.filter((candidate) => candidate.difficulty === level).length;
    const room = Math.max(0, mix[level] - pinned);
    return eligible.filter((candidate) => candidate.difficulty === level).slice(0, room);
  });
}

/** A section's own subject narrows it further than its chosen topics ever could. */
function matches(
  candidate: DrawCandidate,
  section: DrawSection,
  spec: SectionDrawSpec | undefined,
): boolean {
  if (section.subjectId !== null && candidate.subjectId !== section.subjectId) return false;
  if (
    narrows(spec?.topicIds) &&
    (candidate.topicId === null || !spec.topicIds.includes(candidate.topicId))
  ) {
    return false;
  }
  // Any one tag is enough: they name facets of a pool, not a set every question must carry.
  return !narrows(spec?.tags) || spec.tags.some((tag) => candidate.tags.includes(tag));
}

/** Choosing nothing means ALL of them — an empty set narrows to none, which is never the ask. */
export function narrows<T>(values: readonly T[] | undefined): values is readonly T[] {
  return values !== undefined && values.length > 0;
}

const byId = (a: DrawCandidate, b: DrawCandidate) => a.id.localeCompare(b.id);
