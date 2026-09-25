/**
 * Not a test. Measures the scoring queue's drain against the real database: how long a hall of N
 * submitted sittings takes to reach EVALUATED, at the processor's own concurrency.
 *
 * Run: node scripts/bench-scoring.mjs [attempts] [concurrency]
 */
import { execFileSync } from 'node:child_process';
import { ANSWER_STATE, ATTEMPT_STATUS, STUDENT_TYPE, type LiveAnswer } from '@iace/contracts';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { PaperSheetService, SHEET_ROW_SELECT } from '../src/attempts/paper-sheet.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { sheetOf } from '../src/attempts/answer-sheet';
import { FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import { RIGHT_OPTION, makePaper, resetDatabase, testPrisma, uid } from './support/database';

const ATTEMPTS = Number(process.argv[2] ?? 500);
const CONCURRENCY = Number(process.argv[3] ?? 8);

/** One RRB JE paper: 100 questions over three sections, which is the shape an event actually sits. */
const SECTIONS = ['General Awareness', 'Reasoning', 'Mathematics'] as const;
const QUESTIONS = 100;
/** What a real sheet looks like: most answered, a few wrong, the tail never visited. */
const ANSWERED = 85;

const prisma = testPrisma();

const chosenFor = (index: number): string | null => {
  if (index >= ANSWERED) return null;
  return index % 3 === 0 ? 'o2' : RIGHT_OPTION;
};

async function seed(): Promise<string[]> {
  await resetDatabase(prisma);
  const paper = await makePaper(prisma, {
    sections: SECTIONS,
    questions: Array.from({ length: QUESTIONS }, (_, index) => ({
      subject: SECTIONS[index % SECTIONS.length] ?? 'Reasoning',
      section: index % SECTIONS.length,
    })),
  });

  const paperRows = await prisma.paperQuestion.findMany({
    where: { testId: paper.testId },
    orderBy: { order: 'asc' },
    select: SHEET_ROW_SELECT,
  });

  const startedAt = new Date('2026-08-24T04:30:00.000Z');
  const submittedAt = new Date('2026-08-24T05:00:00.000Z');
  const answers: Record<string, LiveAnswer> = Object.fromEntries(
    paper.items.map((item, index) => {
      const selectedOptionId = chosenFor(index);
      return [
        item.questionId,
        {
          state: selectedOptionId === null ? ANSWER_STATE.NOT_VISITED : ANSWER_STATE.ANSWERED,
          selectedOptionId,
          typedAnswer: null,
          timeSpentSec: 30,
          answeredAt: null,
          firstActionAt: null,
        },
      ];
    }),
  );
  const sheet = sheetOf(answers, paperRows, startedAt);

  const students = Array.from({ length: ATTEMPTS }, (_, index) => ({
    id: uid(),
    mobile: String(9_000_000_000 + index),
    studentType: STUDENT_TYPE.ONLINE,
    fullName: 'Bench Student',
  }));
  const attempts = students.map((student) => ({
    id: uid(),
    testId: paper.testId,
    studentId: student.id,
    attemptNo: 1,
    isGraded: true,
    status: ATTEMPT_STATUS.SUBMITTED,
    startedAt,
    endsAt: new Date(startedAt.getTime() + 60 * 60 * 1000),
    submittedAt,
    shuffleSeed: 7,
  }));

  await prisma.student.createMany({ data: students });
  await prisma.attempt.createMany({ data: attempts });
  await prisma.attemptSheet.createMany({
    data: attempts.map((attempt) => ({ attemptId: attempt.id, answers: sheet })),
  });

  return attempts.map((attempt) => attempt.id);
}

interface DatabaseCounters {
  xact_commit: bigint;
  tup_fetched: bigint;
  tup_inserted: bigint;
  tup_updated: bigint;
  blks_hit: bigint;
  blks_read: bigint;
}

const counters = async (): Promise<DatabaseCounters> => {
  // Since 15 a session caches its stats snapshot, so two reads in one run would answer the same numbers.
  await prisma.$executeRaw`SELECT pg_stat_clear_snapshot()`;
  const [row] = await prisma.$queryRaw<DatabaseCounters[]>`
    SELECT xact_commit, tup_fetched, tup_inserted, tup_updated, blks_hit, blks_read
    FROM pg_stat_database WHERE datname = current_database()`;
  if (!row) throw new Error('pg_stat_database answered nothing');
  return row;
};

const delta = (before: DatabaseCounters, after: DatabaseCounters, key: keyof DatabaseCounters) =>
  Number(after[key] - before[key]);

/** Postgres's own CPU, read from its cgroup: the one number that carries to a 2-vCPU instance. */
function postgresCpuUsec(): number {
  const stat = execFileSync('docker', ['exec', 'iace-postgres', 'cat', '/sys/fs/cgroup/cpu.stat'], {
    encoding: 'utf8',
  });
  return Number(/usage_usec (\d+)/.exec(stat)?.[1] ?? 0);
}

function percentile(sorted: readonly number[], share: number): number {
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * share));
  return sorted[at] ?? 0;
}

async function drain(ids: readonly string[], processor: ScoringProcessor): Promise<number[]> {
  const latencies: number[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let mine = next++; mine < ids.length; mine = next++) {
      const id = ids[mine];
      if (id === undefined) return;
      const at = performance.now();
      await processor.score(id);
      latencies.push(performance.now() - at);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return latencies;
}

async function main(): Promise<void> {
  const seededAt = performance.now();
  const ids = await seed();
  const seedMs = performance.now() - seededAt;

  const processor = new ScoringProcessor(
    prisma,
    new RollupQueue(new FakeQueue().asQueue()),
    new NotificationOutbox(new FakeQueue().asQueue()),
    fakeQueueFailures(),
    new PaperSheetService(prisma),
    new RollupService(prisma),
  );

  // One score outside the measurement so the paper cache and the pool are warm, as they are in a live hall.
  const [warm, ...rest] = ids;
  if (warm) await processor.score(warm);

  const before = await counters();
  const dbCpuBefore = postgresCpuUsec();
  const nodeCpuBefore = process.cpuUsage();
  const at = performance.now();
  const latencies = await drain(rest, processor);
  const wallMs = performance.now() - at;
  const nodeCpu = process.cpuUsage(nodeCpuBefore);
  const dbCpuUsec = postgresCpuUsec() - dbCpuBefore;
  const after = await counters();

  const evaluated = await prisma.attempt.count({ where: { status: ATTEMPT_STATUS.EVALUATED } });
  const sorted = [...latencies].sort((a, b) => a - b);
  const scored = latencies.length;

  process.stdout.write(
    `${JSON.stringify(
      {
        attempts: ATTEMPTS,
        concurrency: CONCURRENCY,
        questionsPerPaper: QUESTIONS,
        seedSec: +(seedMs / 1000).toFixed(1),
        evaluated,
        wallSec: +(wallMs / 1000).toFixed(2),
        perSecond: +((scored / wallMs) * 1000).toFixed(1),
        latencyMs: {
          p50: +percentile(sorted, 0.5).toFixed(1),
          p95: +percentile(sorted, 0.95).toFixed(1),
          max: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
        },
        perAttempt: {
          transactions: +(delta(before, after, 'xact_commit') / scored).toFixed(1),
          tuplesFetched: +(delta(before, after, 'tup_fetched') / scored).toFixed(1),
          tuplesInserted: +(delta(before, after, 'tup_inserted') / scored).toFixed(1),
          tuplesUpdated: +(delta(before, after, 'tup_updated') / scored).toFixed(1),
        },
        cpuMsPerAttempt: {
          postgres: +(dbCpuUsec / 1000 / scored).toFixed(2),
          node: +((nodeCpu.user + nodeCpu.system) / 1000 / scored).toFixed(2),
        },
        cacheHitRate: +(
          delta(before, after, 'blks_hit') /
          Math.max(1, delta(before, after, 'blks_hit') + delta(before, after, 'blks_read'))
        ).toFixed(4),
        projectedFiveThousandSec: +(5000 / ((scored / wallMs) * 1000)).toFixed(1),
      },
      null,
      2,
    )}\n`,
  );

  await prisma.$disconnect();
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  },
);
