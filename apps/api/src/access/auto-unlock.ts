import { UNLOCK_MODE, type UnlockMode } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { isUniqueViolation } from '../common/prisma-errors';

/** The two columns the unlock decision reads off a series the student already reaches. */
export interface UnlockRule {
  unlockMode: UnlockMode;
  prerequisiteSeriesId: string | null;
}

/** Plus what the prerequisite is measured in: a series is done when its tests are. */
export interface UnlockCandidate extends UnlockRule {
  id: string;
  directTests: readonly { id: string }[];
}

/** AUTO with nothing in front opens on its own; REQUEST and a pending prerequisite both hold shut. */
export function needsUnlock(row: UnlockRule): boolean {
  return row.unlockMode !== UNLOCK_MODE.AUTO || row.prerequisiteSeriesId !== null;
}

/** Only AUTO opens without being asked, and only once whatever stands in front of it is finished. */
function opensOnItsOwn(row: UnlockCandidate): boolean {
  return row.unlockMode === UNLOCK_MODE.AUTO && row.prerequisiteSeriesId !== null;
}

/** Finished means every test in it is sat; a series holding no tests has nothing anyone can finish. */
function completedSeries(
  series: readonly UnlockCandidate[],
  finished: ReadonlySet<string>,
): Set<string> {
  const done = new Set<string>();
  for (const row of series) {
    const sat = row.directTests.length > 0 && row.directTests.every((t) => finished.has(t.id));
    if (sat) done.add(row.id);
  }
  return done;
}

/** A prerequisite the student cannot reach is not among the rows, so it is not done. */
function prerequisiteDone(row: UnlockCandidate, done: ReadonlySet<string>): boolean {
  return row.prerequisiteSeriesId !== null && done.has(row.prerequisiteSeriesId);
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

/** Opens every AUTO series whose prerequisite this student has now finished, and says which. */
export async function applyAutoUnlocks(
  prisma: PrismaService,
  events: DomainEventBus,
  studentId: string,
  series: readonly UnlockCandidate[],
  finished: ReadonlySet<string>,
  now: Date,
): Promise<string[]> {
  const candidates = series.filter(opensOnItsOwn);
  if (candidates.length === 0) return [];

  const done = completedSeries(series, finished);
  const held = await unlockedAmong(prisma, studentId, candidates);
  // One pass is the whole chain: a series opened here has no sittings yet, so nothing waits on it.
  const opening = candidates.filter((row) => !held.has(row.id) && prerequisiteDone(row, done));
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

/** A row another read just wrote is the outcome this wanted; a catalog GET must not 409 on it. */
function tolerateRace(write: Promise<boolean>): Promise<boolean> {
  return write.catch((error: unknown) => {
    if (!isUniqueViolation(error)) throw error;
    return false;
  });
}

/** What is already open, so a second read does not rewrite a row it wrote a moment ago. */
async function unlockedAmong(
  prisma: PrismaService,
  studentId: string,
  candidates: readonly UnlockCandidate[],
): Promise<Set<string>> {
  const rows = await prisma.studentSeriesUnlock.findMany({
    where: {
      studentId,
      testSeriesId: { in: candidates.map((row) => row.id) },
      unlockedAt: { not: null },
    },
    select: { testSeriesId: true },
  });
  return new Set(rows.map((row) => row.testSeriesId));
}
