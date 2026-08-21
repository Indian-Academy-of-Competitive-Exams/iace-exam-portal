import { UNLOCK_MODE, type UnlockMode } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { isUniqueViolation } from '../common/prisma-errors';

/** The three columns the unlock decision reads off a series the student already reaches. */
export interface UnlockCandidate {
  id: string;
  unlockMode: UnlockMode;
  prerequisiteSeriesId: string | null;
}

/**
 * AUTO opens on its own unless something has to come first; REQUEST and ADMIN never open on
 * their own, so without this both modes would be decoration on an already-open series.
 */
export function needsUnlock(row: Omit<UnlockCandidate, 'id'>): boolean {
  return row.unlockMode !== UNLOCK_MODE.AUTO || row.prerequisiteSeriesId !== null;
}

/**
 * Completing the prerequisite's tests replaces this the day the exam module lands and there are
 * attempts to read. Until then an AUTO series behind one opens on the first read that reaches it.
 */
function prerequisiteSatisfied(row: UnlockCandidate, unlocked: ReadonlySet<string>): boolean {
  return row.prerequisiteSeriesId === null || unlocked.has(row.prerequisiteSeriesId);
}

/** AUTO with nothing in front opens without a row at all, so it is not a candidate for one. */
function opensOnItsOwn(row: UnlockCandidate): boolean {
  return row.unlockMode === UNLOCK_MODE.AUTO && row.prerequisiteSeriesId !== null;
}

/**
 * The one write that opens a series for a student, answering whether THIS call opened it: a row
 * that already carries a time keeps it, and is news to nobody.
 */
export async function openUnlock(
  prisma: PrismaService,
  studentId: string,
  testSeriesId: string,
  unlockedAt: Date,
): Promise<boolean> {
  const key = { studentId, testSeriesId };
  const held = await prisma.studentSeriesUnlock.findUnique({
    where: { studentId_testSeriesId: key },
    select: { unlockedAt: true },
  });
  if (held?.unlockedAt) return false;

  await prisma.studentSeriesUnlock.upsert({
    where: { studentId_testSeriesId: key },
    create: { ...key, unlockedAt },
    update: {},
  });
  // A row with no time on it is still a LOCKED row, and an empty `update` cannot heal one.
  await prisma.studentSeriesUnlock.updateMany({
    where: { ...key, unlockedAt: null },
    data: { unlockedAt },
  });
  return true;
}

/**
 * Opens every AUTO series whose prerequisite the student has already unlocked, and answers with
 * the ids it opened so the resolution that called it reflects them without reading again.
 */
export async function applyAutoUnlocks(
  prisma: PrismaService,
  events: DomainEventBus,
  studentId: string,
  series: readonly UnlockCandidate[],
  now: Date,
): Promise<string[]> {
  const candidates = series.filter(opensOnItsOwn);
  if (candidates.length === 0) return [];

  const held = await unlockedAmong(prisma, studentId, candidates);
  // A series that opens without a row has no row to find, so without this a prerequisite nobody
  // ever writes a row for would hold everything behind it shut for good.
  for (const row of series) {
    if (!needsUnlock(row)) held.add(row.id);
  }

  const opening = openableNow(candidates, held);
  if (opening.length === 0) return [];

  const opened = await Promise.all(
    opening.map((row) => tolerateRace(openUnlock(prisma, studentId, row.id, now))),
  );

  const announced = opening.filter((_, index) => opened[index]);
  for (const row of announced) {
    events.emit(DOMAIN_EVENTS.SERIES_UNLOCKED, { studentId, testSeriesId: row.id });
  }
  // The caller's own answer is already right; this is for every OTHER cached shape of it.
  events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });

  return opening.map((row) => row.id);
}

/**
 * A chain opens end to end on one read: what a pass opens is the prerequisite the next pass is
 * waiting on, so stopping after one would cost a catalog read per link.
 */
function openableNow(candidates: readonly UnlockCandidate[], held: Set<string>): UnlockCandidate[] {
  const opening: UnlockCandidate[] = [];
  let waiting = candidates.filter((row) => !held.has(row.id));
  let ready = waiting.filter((row) => prerequisiteSatisfied(row, held));

  while (ready.length > 0) {
    for (const row of ready) held.add(row.id);
    opening.push(...ready);
    waiting = waiting.filter((row) => !held.has(row.id));
    ready = waiting.filter((row) => prerequisiteSatisfied(row, held));
  }

  return opening;
}

/** A row another read just wrote is the outcome this wanted; a catalog GET must not 409 on it. */
function tolerateRace(write: Promise<boolean>): Promise<boolean> {
  return write.catch((error: unknown) => {
    if (!isUniqueViolation(error)) throw error;
    return false;
  });
}

/** One read covering both halves of the question: what is open, and what stands in front of it. */
async function unlockedAmong(
  prisma: PrismaService,
  studentId: string,
  candidates: readonly UnlockCandidate[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const row of candidates) {
    ids.add(row.id);
    if (row.prerequisiteSeriesId !== null) ids.add(row.prerequisiteSeriesId);
  }

  const rows = await prisma.studentSeriesUnlock.findMany({
    where: { studentId, testSeriesId: { in: [...ids] }, unlockedAt: { not: null } },
    select: { testSeriesId: true },
  });
  return new Set(rows.map((row) => row.testSeriesId));
}
