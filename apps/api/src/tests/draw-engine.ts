import {
  DIFFICULTY_LEVELS,
  type DifficultyLevel,
  type DrawSpec,
  type SectionDrawSpec,
} from '@iace/contracts';
import { seededRandom, shuffle } from '../common/seeded-shuffle';

/** The ONE draw. Pure: it is handed a pool and returns a paper, so it needs no database. */

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
  order: number;
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

/** A paper or the reason there isn't one — never a short paper that reads like a whole one. */
export type DrawResult =
  { ok: true; questions: DrawnQuestion[] } | { ok: false; shortfalls: SectionShortfall[] };

export interface DrawRequest {
  sections: readonly DrawSection[];
  pool: readonly DrawCandidate[];
  /** What each section draws from: its topics, and how many of each difficulty. */
  spec?: DrawSpec | null;
  /** Same seed, same pool, same paper — which is what makes a re-draw a decision, not a dice roll. */
  seed: number;
  /** Chosen by hand, per section, already resolved against the bank. The draw fills what is left. */
  pinned?: ReadonlyMap<string, readonly DrawCandidate[]>;
}

/** Fills every section to its exact count, or says which ones it could not. */
export function drawPaper(request: DrawRequest): DrawResult {
  const random = seededRandom(request.seed);
  // Sorted by id first, so the SEED decides the paper and not the order the rows arrived in.
  const ordered = shuffle([...request.pool].sort(byId), random);

  const questions: DrawnQuestion[] = [];
  const shortfalls: SectionShortfall[] = [];
  // Pins are spoken for up front, or an earlier section draws one a later section was pinned to.
  const used = new Set(pinnedIds(request.pinned));

  for (const section of [...request.sections].sort(byOrder)) {
    const chosen = request.pinned?.get(section.id) ?? [];
    const sectionSpec = request.spec?.sections?.[section.id];
    const eligible = ordered.filter(
      (candidate) => !used.has(candidate.id) && matches(candidate, section, sectionSpec),
    );
    const taken = [...chosen, ...fill(section, sectionSpec, chosen, eligible)];

    for (const candidate of taken) {
      used.add(candidate.id);
      questions.push({
        baseConfigSectionId: section.id,
        questionId: candidate.id,
        questionVersionId: candidate.currentVersionId,
        order: questions.length + 1,
        marks: section.marksPerQuestion,
        negativeMarks: section.negativeMarks,
      });
    }

    // Counted AFTER the earlier sections took theirs, because that is the number an admin has to act on.
    if (taken.length < section.questionCount) {
      shortfalls.push({
        baseConfigSectionId: section.id,
        sectionName: section.name,
        needed: section.questionCount,
        available: taken.length,
      });
    }
  }

  return shortfalls.length > 0 ? { ok: false, shortfalls } : { ok: true, questions };
}

function pinnedIds(pinned: DrawRequest['pinned']): string[] {
  return [...(pinned?.values() ?? [])].flatMap((picks) => picks.map((pick) => pick.id));
}

const byOrder = (a: DrawSection, b: DrawSection) => a.order - b.order;

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
function narrows<T>(values: readonly T[] | undefined): values is readonly T[] {
  return values !== undefined && values.length > 0;
}

const byId = (a: DrawCandidate, b: DrawCandidate) => a.id.localeCompare(b.id);
