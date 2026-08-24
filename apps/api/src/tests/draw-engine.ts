import {
  DRAW_STRATEGY,
  type DifficultyLevel,
  type DrawStrategy,
  type QuestionPoolFilter,
} from '@iace/contracts';

/** The ONE draw. Pure: it is handed a pool and returns a paper, so it needs no database. */

/** A question as the draw reads it — the columns that decide, and the version it would pin. */
export interface DrawCandidate {
  id: string;
  currentVersionId: string;
  subjectId: string;
  topicId: string | null;
  difficulty: DifficultyLevel;
  tags: readonly string[];
  createdAt: Date;
  fixedUseCount: number;
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
  strategy: DrawStrategy;
  filter?: QuestionPoolFilter | null;
  /** Same seed, same pool, same paper — which is what makes a re-draw a decision, not a dice roll. */
  seed: number;
  /** What this student has already been served. Empty at finalize, real per attempt in Phase 3. */
  seen?: ReadonlySet<string>;
  /** Chosen by hand, per section, already resolved against the bank. The draw fills what is left. */
  pinned?: ReadonlyMap<string, readonly DrawCandidate[]>;
}

/** Fills every section to its exact count, or says which ones it could not. */
export function drawPaper(request: DrawRequest): DrawResult {
  const random = seededRandom(request.seed);
  const ordered = orderPool(request.pool, request.strategy, random, request.seen ?? EMPTY_SEEN);

  const questions: DrawnQuestion[] = [];
  const shortfalls: SectionShortfall[] = [];
  // Pins are spoken for up front, or an earlier section draws one a later section was pinned to.
  const used = new Set(pinnedIds(request.pinned));

  for (const section of [...request.sections].sort(byOrder)) {
    const chosen = request.pinned?.get(section.id) ?? [];
    const room = Math.max(0, section.questionCount - chosen.length);
    const eligible = ordered.filter(
      (candidate) => !used.has(candidate.id) && matches(candidate, section, request.filter),
    );
    const taken = [...chosen, ...eligible.slice(0, room)];

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

const EMPTY_SEEN: ReadonlySet<string> = new Set<string>();

function pinnedIds(pinned: DrawRequest['pinned']): string[] {
  return [...(pinned?.values() ?? [])].flatMap((picks) => picks.map((pick) => pick.id));
}

/** What a hand-picked paper has to satisfy before the draw is asked to fill the rest of it. */
export function manualPickIssues(
  sections: readonly DrawSection[],
  pinned: ReadonlyMap<string, readonly DrawCandidate[]>,
): string[] {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const issues: string[] = [];
  const counts = new Map<string, number>();

  for (const [sectionId, picks] of pinned) {
    const section = byId.get(sectionId);
    if (!section) {
      issues.push('A question was chosen for a section this configuration does not have.');
      continue;
    }
    if (picks.length > section.questionCount) {
      issues.push(
        `${section.name} holds ${section.questionCount}, and ${picks.length} were chosen for it.`,
      );
    }
    const offSubject = picks.filter(
      (pick) => section.subjectId !== null && pick.subjectId !== section.subjectId,
    );
    if (offSubject.length > 0) {
      issues.push(`${offSubject.length} chosen for ${section.name} are not from its subject.`);
    }
    for (const pick of picks) counts.set(pick.id, (counts.get(pick.id) ?? 0) + 1);
  }

  const repeated = [...counts.values()].filter((count) => count > 1).length;
  if (repeated > 0) {
    issues.push(`${repeated} chosen twice — a paper cannot ask the same question in two places.`);
  }

  return issues;
}

const byOrder = (a: DrawSection, b: DrawSection) => a.order - b.order;

/** A section's own subject narrows it further than the test-wide filter ever could. */
function matches(
  candidate: DrawCandidate,
  section: DrawSection,
  filter: QuestionPoolFilter | null | undefined,
): boolean {
  if (section.subjectId !== null && candidate.subjectId !== section.subjectId) return false;
  if (!filter) return true;
  if (narrows(filter.subjectIds) && !filter.subjectIds.includes(candidate.subjectId)) return false;
  if (
    narrows(filter.topicIds) &&
    (candidate.topicId === null || !filter.topicIds.includes(candidate.topicId))
  ) {
    return false;
  }
  if (narrows(filter.difficulties) && !filter.difficulties.includes(candidate.difficulty)) {
    return false;
  }
  // Any one of the tags is enough: they name facets of a pool, not a set every question must carry.
  if (narrows(filter.tags) && !filter.tags.some((tag) => candidate.tags.includes(tag)))
    return false;
  return true;
}

/** Choosing nothing means ALL of them — an empty set narrows to none, which is never the ask. */
function narrows<T>(values: readonly T[] | undefined): values is readonly T[] {
  return values !== undefined && values.length > 0;
}

/** By id first, so the SEED decides and not whatever order the rows arrived in. */
function orderPool(
  pool: readonly DrawCandidate[],
  strategy: DrawStrategy,
  random: () => number,
  seen: ReadonlySet<string>,
): DrawCandidate[] {
  const shuffled = shuffle([...pool].sort(byId), random);
  const rank = rankOf(strategy, seen);
  return rank ? shuffled.sort((a, b) => rank(a) - rank(b)) : shuffled;
}

const byId = (a: DrawCandidate, b: DrawCandidate) => a.id.localeCompare(b.id);

function rankOf(
  strategy: DrawStrategy,
  seen: ReadonlySet<string>,
): ((candidate: DrawCandidate) => number) | null {
  switch (strategy) {
    case DRAW_STRATEGY.NEWEST_FIRST:
      return (candidate) => -candidate.createdAt.getTime();
    case DRAW_STRATEGY.LEAST_SERVED:
      return (candidate) => candidate.fixedUseCount;
    case DRAW_STRATEGY.UNSEEN_FIRST:
      return (candidate) => (seen.has(candidate.id) ? 1 : 0);
    default:
      return null;
  }
}

function shuffle(items: readonly DrawCandidate[], random: () => number): DrawCandidate[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const PRNG_INCREMENT = 0x6d2b79f5;
const UINT32 = 4294967296;

/** mulberry32. A paper draw is reproducible, not secret — nothing here guards anything. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + PRNG_INCREMENT) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}
