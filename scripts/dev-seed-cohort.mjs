/**
 * DEV-ONLY: one finalized test and ~200 submitted sittings for it, so scoring, ranking and the
 * report have something to compute over. Every row carries a `_cohort_` id, so `--reset` purges
 * the cohort and nothing else; marks are left NULL, because filling them is the worker's job.
 * Refuses a DATABASE_URL that is not local. Run: node scripts/dev-seed-cohort.mjs [--reset]
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// --- env: whatever the shell has not already set, taken from .env ---
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const at = line.indexOf('=');
    const key = at > 0 ? line.slice(0, at).trim() : '';
    if (!key || key.startsWith('#') || process.env[key]) continue;
    process.env[key] = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env — rely on the shell */
}

const url = process.env.DATABASE_URL ?? '';
const looksLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres|db)[:/]/.test(url);
if (!looksLocal && process.env.FORCE_DEV_SEED !== '1') {
  console.error(
    `Refusing to run: DATABASE_URL does not look local.\n  ${url || '(unset)'}\n  Set FORCE_DEV_SEED=1 to override on a disposable database.`,
  );
  process.exit(1);
}

// --- the shape of the cohort ------------------------------------------------

const MARK = '_cohort_';
const IDS = {
  branch: `brn${MARK}1`,
  config: `cfg${MARK}1`,
  sectionA: `sec${MARK}a`,
  sectionB: `sec${MARK}b`,
  test: `tst${MARK}1`,
  series: `srs${MARK}1`,
  student: (i) => `stu${MARK}${String(i).padStart(3, '0')}`,
  attempt: (i) => `att${MARK}${String(i).padStart(3, '0')}`,
  paper: (order) => `pq${MARK}${String(order).padStart(3, '0')}`,
};

/** Mirrors SCORING_REQUEST in apps/api/src/attempts/scoring-outbox.ts — the relay reads this. */
const SCORING_REQUEST = { aggregateType: 'Attempt', eventType: 'attempt.scoring_requested' };

const SECTIONS = [
  { id: IDS.sectionA, name: 'Section A', order: 1, questionCount: 20, marks: 2, negative: 0.5 },
  { id: IDS.sectionB, name: 'Section B', order: 2, questionCount: 10, marks: 1, negative: 0.25 },
];
const TOTAL_QUESTIONS = SECTIONS.reduce((sum, section) => sum + section.questionCount, 0);
const TOTAL_MARKS = SECTIONS.reduce(
  (sum, section) => sum + section.questionCount * section.marks,
  0,
);

const DURATION_SEC = 1800;

/** How late a branch may still let somebody in. Without one, entry never shuts and no key opens. */
const LATE_ENTRY_SEC = 2 * 60 * 60;
const STUDENTS = 200;
const CHUNK = 500;
const DIFFICULTIES = ['LOW', 'MEDIUM', 'HIGH'];
const SUBMITTED_DAYS_AGO = 2;

/** Every fifth answer is left flagged, and every third sitting walks away from a question it saw. */
const MARK_EVERY = 5;
const LEAVES_QUESTIONS_SEEN = 3;

/** Right, then wrong, then untouched — deterministic, so a paper can be hand-counted against it. */
function sittingPlan(index) {
  if (index === 0) return { answered: TOTAL_QUESTIONS, correct: TOTAL_QUESTIONS };
  if (index === 1) return { answered: 0, correct: 0 };
  if (index === 2) return { answered: TOTAL_QUESTIONS, correct: 0 };
  const answered = TOTAL_QUESTIONS - (index % 6);
  return { answered, correct: Math.max(0, answered - ((index * 7) % 19)) };
}

/** Seconds one sitting spent per question it touched. Varies, so equal marks break on speed. */
const paceOf = (index) => 20 + (index % 11);

// --- helpers ----------------------------------------------------------------

async function chunked(rows, write) {
  for (let start = 0; start < rows.length; start += CHUNK) {
    await write(rows.slice(start, start + CHUNK));
  }
}

function correctOptionOf(version) {
  const options = Array.isArray(version?.options) ? version.options : [];
  const correct = options.find((option) => option?.isCorrect === true);
  return { correct: correct?.id ?? null, all: options.map((option) => option?.id) };
}

const ANSWERABLE = { status: 'ACTIVE', currentVersionId: { not: null }, type: 'SINGLE_MCQ' };

/** How much each subject has, counted rather than loaded — the bank is tens of thousands of rows. */
async function subjectDepths(prisma) {
  const counted = await prisma.question.groupBy({
    by: ['subjectId'],
    where: ANSWERABLE,
    _count: { _all: true },
  });
  return counted
    .map((row) => ({ subjectId: row.subjectId, available: row._count._all }))
    .sort((a, b) => b.available - a.available);
}

/** `need` questions from one subject, drawn evenly across difficulty so it is never all-HIGH. */
async function questionsFrom(prisma, subjectId, need) {
  const perBand = Math.ceil(need / DIFFICULTIES.length);
  const bands = await Promise.all(
    DIFFICULTIES.map((difficulty) =>
      prisma.question.findMany({
        where: { ...ANSWERABLE, subjectId, difficulty },
        select: {
          id: true,
          difficulty: true,
          currentVersionId: true,
          currentVersion: { select: { options: true } },
        },
        orderBy: { id: 'asc' },
        take: perBand + need,
      }),
    ),
  );

  const picked = [];
  for (let depth = 0; picked.length < need; depth += 1) {
    const before = picked.length;
    for (const band of bands) {
      const row = band[depth];
      if (!row || picked.length >= need) continue;
      const { correct, all } = correctOptionOf(row.currentVersion);
      if (!correct || all.length < 2) continue;
      picked.push({ ...row, correctOptionId: correct, optionIds: all });
    }
    // Every band ran dry at this depth, so nothing deeper will fill it either.
    if (picked.length === before) break;
  }
  return picked;
}

/** One subject per section where the bank allows it, so subject analytics has two buckets. */
async function assign(prisma) {
  const depths = await subjectDepths(prisma);
  const picked = [];

  for (const section of SECTIONS) {
    const taken = picked.map((entry) => entry.subjectId);
    const free = depths.find(
      (row) => !taken.includes(row.subjectId) && row.available >= section.questionCount,
    );
    const shared = depths.find((row) => row.available >= section.questionCount);
    const chosen = free ?? shared;
    if (!chosen) return null;

    const questions = await questionsFrom(prisma, chosen.subjectId, section.questionCount);
    if (questions.length < section.questionCount) return null;
    picked.push({ section, subjectId: chosen.subjectId, questions });
  }
  return picked;
}

// --- purge ------------------------------------------------------------------

async function purge(prisma) {
  const attempts = await prisma.attempt.findMany({
    where: { id: { startsWith: `att${MARK}` } },
    select: { id: true },
  });
  const attemptIds = attempts.map((row) => row.id);

  await prisma.attemptQuestion.deleteMany({ where: { attemptId: { in: attemptIds } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: attemptIds } } });
  await prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } });
  await prisma.paperQuestion.deleteMany({ where: { testId: IDS.test } });
  await prisma.branchTestSchedule.deleteMany({ where: { testId: IDS.test } });
  await prisma.testSeriesTest.deleteMany({ where: { testId: IDS.test } });
  await prisma.branchTestConfig.deleteMany({ where: { testSeriesId: IDS.series } });
  await prisma.testSeries.deleteMany({ where: { id: IDS.series } });
  await prisma.test.deleteMany({ where: { id: IDS.test } });
  await prisma.baseConfigSection.deleteMany({ where: { baseConfigId: IDS.config } });
  await prisma.baseConfig.deleteMany({ where: { id: IDS.config } });
  await prisma.studentProfile.deleteMany({ where: { studentId: { startsWith: `stu${MARK}` } } });
  await prisma.student.deleteMany({ where: { id: { startsWith: `stu${MARK}` } } });
  await prisma.branch.deleteMany({ where: { id: IDS.branch } });

  return attemptIds.length;
}

// --- the paper --------------------------------------------------------------

async function writePaper(prisma, stageId, assigned) {
  await prisma.baseConfig.create({
    data: {
      id: IDS.config,
      examStageId: stageId,
      name: '[COHORT] Scoring rehearsal',
      isDefault: false,
      totalQuestions: TOTAL_QUESTIONS,
      totalMarks: TOTAL_MARKS,
      durationSec: DURATION_SEC,
      shuffleQuestions: false,
      shuffleOptions: false,
      sections: {
        create: assigned.map(({ section, subjectId }) => ({
          id: section.id,
          name: section.name,
          order: section.order,
          subjectId,
          questionCount: section.questionCount,
          marksPerQuestion: section.marks,
          negativeMarks: section.negative,
        })),
      },
    },
  });

  // Locked AFTER its sections exist: a trigger refuses a shape change to a locked blueprint.
  await prisma.baseConfig.update({ where: { id: IDS.config }, data: { locked: true } });

  const finalizedAt = new Date();
  await prisma.test.create({
    data: {
      id: IDS.test,
      title: '[COHORT] Scoring rehearsal — Mock 1',
      baseConfigId: IDS.config,
      examStageId: stageId,
      status: 'ACTIVE',
      isLocked: true,
      version: 1,
      finalizedAt,
    },
  });

  const paper = [];
  let order = 0;
  for (const { section, questions } of assigned) {
    for (const question of questions) {
      order += 1;
      paper.push({
        id: IDS.paper(order),
        testId: IDS.test,
        baseConfigId: IDS.config,
        baseConfigSectionId: section.id,
        questionId: question.id,
        questionVersionId: question.currentVersionId,
        variant: 0,
        order,
        marks: section.marks,
        negativeMarks: section.negative,
        correctOptionId: question.correctOptionId,
        optionIds: question.optionIds,
      });
    }
  }

  await prisma.paperQuestion.createMany({
    data: paper.map(({ correctOptionId: _correct, optionIds: _options, ...row }) => row),
  });
  return paper;
}

async function writeOffering(prisma, stageId) {
  const branch = await prisma.branch.findFirst({
    where: { deletedAt: null, isActive: true },
    select: { id: true },
  });
  const branchId = branch?.id ?? IDS.branch;
  if (!branch) {
    await prisma.branch.create({
      data: { id: IDS.branch, name: 'COHORT REHEARSAL', type: 'VIRTUAL' },
    });
  }

  await prisma.testSeries.create({
    data: { id: IDS.series, name: '[COHORT] Scoring rehearsal', examStageId: stageId },
  });
  await prisma.testSeriesTest.create({
    data: {
      testSeriesId: IDS.series,
      testId: IDS.test,
      order: 1,
      unlockAt: new Date(Date.now() - SUBMITTED_DAYS_AGO * DAY_MS),
    },
  });
  await prisma.branchTestConfig.create({
    data: { branchId, testSeriesId: IDS.series, enabled: true },
  });
  // A late-entry cap is what lets entry CLOSE, which is what opens the solution gate.
  await prisma.branchTestSchedule.create({
    data: { branchId, testId: IDS.test, lateEntrySec: LATE_ENTRY_SEC, extraTimeSec: null },
  });
  return branchId;
}

// --- the cohort -------------------------------------------------------------

async function writeStudents(prisma, branchId) {
  const rows = Array.from({ length: STUDENTS }, (_, index) => ({
    id: IDS.student(index),
    mobile: String(FIRST_MOBILE + index),
    studentType: 'OFFLINE',
    currentBranchId: branchId,
    fullName: `Cohort Candidate ${String(index + 1).padStart(3, '0')}`,
    pinIsDefault: true,
  }));
  await chunked(rows, (batch) => prisma.student.createMany({ data: batch, skipDuplicates: true }));
  return rows.length;
}

/** One sitting's answers, in paper order: right, then wrong, then never touched. */
function answersFor(index, paper) {
  const { answered, correct } = sittingPlan(index);
  const pace = paceOf(index);
  const leavesSeen = index % LEAVES_QUESTIONS_SEEN === 0;

  return paper.map((row, position) => {
    if (position >= answered) {
      return {
        selectedOptionId: null,
        state: leavesSeen && position === answered ? 'NOT_ANSWERED' : 'NOT_VISITED',
        timeSpentSec: leavesSeen && position === answered ? pace : 0,
      };
    }
    const wrong = row.optionIds.find((id) => id !== row.correctOptionId) ?? row.correctOptionId;
    return {
      selectedOptionId: position < correct ? row.correctOptionId : wrong,
      state: position % MARK_EVERY === 0 ? 'ANSWERED_MARKED' : 'ANSWERED',
      timeSpentSec: pace,
    };
  });
}

async function writeSittings(prisma, paper) {
  const openedAt = new Date(Date.now() - SUBMITTED_DAYS_AGO * DAY_MS);
  const attempts = [];
  const items = [];
  const events = [];

  for (let index = 0; index < STUDENTS; index += 1) {
    const answers = answersFor(index, paper);
    const spent = answers.reduce((sum, answer) => sum + answer.timeSpentSec, 0);
    const attemptId = IDS.attempt(index);

    attempts.push({
      id: attemptId,
      testId: IDS.test,
      studentId: IDS.student(index),
      attemptNo: 1,
      isGraded: true,
      status: 'SUBMITTED',
      startedAt: openedAt,
      endsAt: new Date(openedAt.getTime() + DURATION_SEC * 1000),
      submittedAt: new Date(openedAt.getTime() + spent * 1000),
      shuffleSeed: index + 1,
      languages: ['EN'],
    });

    answers.forEach((answer, position) => {
      const row = paper[position];
      items.push({
        attemptId,
        questionId: row.questionId,
        paperQuestionId: row.id,
        questionVersionId: row.questionVersionId,
        baseConfigSectionId: row.baseConfigSectionId,
        order: row.order,
        selectedOptionId: answer.selectedOptionId,
        state: answer.state,
        timeSpentSec: answer.timeSpentSec,
        answeredAt: answer.selectedOptionId ? openedAt : null,
      });
    });

    events.push({
      aggregateType: SCORING_REQUEST.aggregateType,
      aggregateId: attemptId,
      eventType: SCORING_REQUEST.eventType,
      payload: { testId: IDS.test },
      createdAt: openedAt,
    });
  }

  await chunked(attempts, (batch) => prisma.attempt.createMany({ data: batch }));
  await chunked(items, (batch) => prisma.attemptQuestion.createMany({ data: batch }));
  await chunked(events, (batch) => prisma.outboxEvent.createMany({ data: batch }));
  return { attempts: attempts.length, items: items.length };
}

// --- run --------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_MOBILE = 9500000000;

async function main() {
  const reset = process.argv.includes('--reset');
  const prisma = new PrismaClient();
  try {
    const standing = await prisma.test.count({ where: { id: IDS.test } });
    if (standing > 0 && !reset) {
      console.error(
        'A cohort is already seeded. Re-run with --reset to replace it, or leave it alone.',
      );
      process.exit(1);
    }
    if (reset) {
      const removed = await purge(prisma);
      console.log(`Purged the old cohort (${removed} sittings).`);
    }

    const stage = await prisma.examStage.findFirst({
      where: { isActive: true, disposition: 'CONDUCTED' },
      orderBy: [{ examId: 'asc' }, { order: 'asc' }],
      select: { id: true, stageKey: true },
    });
    if (!stage) {
      console.error('Seed the catalog first — no conducted exam stage to hang a test off.');
      process.exit(1);
    }

    const assigned = await assign(prisma);
    if (!assigned) {
      console.error(
        `Seed a question pool first — no subject has ${TOTAL_QUESTIONS} answerable ACTIVE questions.`,
      );
      process.exit(1);
    }

    const paper = await writePaper(prisma, stage.id, assigned);
    const branchId = await writeOffering(prisma, stage.id);
    const students = await writeStudents(prisma, branchId);
    const { attempts, items } = await writeSittings(prisma, paper);

    console.log(`\nDone, on stage ${stage.stageKey}.`);
    console.log(`  Paper:    ${paper.length} questions, ${TOTAL_MARKS} marks, ${DURATION_SEC}s`);
    for (const { section, subjectId, questions } of assigned) {
      console.log(
        `    ${section.name}: ${questions.length} × ${section.marks} / −${section.negative} (subject ${subjectId})`,
      );
    }
    console.log(
      `  Cohort:   ${students} students, ${attempts} submitted sittings, ${items} answers`,
    );
    console.log(
      `  Waiting:  ${attempts} scoring requests in the outbox — run the API to drain them`,
    );
    console.log(
      `  Key:      entry closed ${LATE_ENTRY_SEC / 3600}h after unlock, so the solution gate is open`,
    );
    console.log(`Purge with: node scripts/dev-seed-cohort.mjs --reset`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
