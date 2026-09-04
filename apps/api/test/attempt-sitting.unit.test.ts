import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  EXAM_COURSE,
  EXAM_TEMPLATE,
  LANGUAGE_CODE,
  TEST_STATUS,
  type AnswerChange,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AttemptsService } from '../src/attempts/attempts.service';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptPaperService } from '../src/attempts/attempt-paper.service';
import { AttemptFlushProcessor } from '../src/attempts/attempt-flush.processor';
import { ScoringOutbox } from '../src/attempts/scoring-outbox';
import { SubmitService } from '../src/attempts/submit.service';
import { QUEUE_NAMES } from '../src/queue/queues';
import {
  FakeCatalogPrisma,
  FakeMetrics,
  FakeQueue,
  FakeRedis,
  FakeTestsPrisma,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeSeries,
  makeStudent,
  makeTest,
  makeTestRow,
  type FakePaperRow,
  type FakeServedVersion,
} from './support/fakes';

/** One sitting end to end: catalog, start, paper, autosave, flush, submit — the services' one meeting. */

const STUDENT = 'stu_1';
const TEST = 'tst_1';
const BRANCH = 'br_1';
const COURSE = EXAM_COURSE.SSC;

const SECTIONS = [
  makeSection({ id: 'sec_1', name: 'Reasoning', order: 1, questionCount: 2, durationSec: null }),
];

const paperRows = (): FakePaperRow[] =>
  [1, 2].map((n) => ({
    id: `pq_${n}`,
    testId: TEST,
    baseConfigId: 'cfg_1',
    baseConfigSectionId: 'sec_1',
    questionId: `q${n}`,
    questionVersionId: `q${n}_v1`,
    variant: 0,
    order: n,
    marks: 2,
    negativeMarks: 0.5,
    status: 'ACTIVE' as const,
  }));

/** Options as the column holds them — `isCorrect` and all. What crosses to the browser must not. */
const version = (id: string, correct: string): FakeServedVersion => ({
  id,
  content: { en: { stem: [{ text: 'What comes next?' }], solution: [{ text: 'Because.' }] } },
  options: ['a', 'b'].map((letter, index) => ({
    id: `${id}_${letter}`,
    position: index + 1,
    isCorrect: `${id}_${letter}` === correct,
    text: { en: [{ text: letter.toUpperCase() }] },
  })),
});

/** A student at a branch the series is enabled for, and one ACTIVE test inside it. */
function catalogue() {
  const prisma = new FakeCatalogPrisma({
    students: [makeStudent({ id: STUDENT, currentBranchId: BRANCH, enrolledCourses: [COURSE] })],
    series: [makeSeries({ id: 'srs_1', branchIds: [BRANCH] })],
    tests: [
      makeTestRow({ id: TEST, status: TEST_STATUS.ACTIVE, testSeriesId: 'srs_1', seriesOrder: 1 }),
    ],
  });
  return new AccessResolverService(prisma.asService(), new FakeRedis().asService());
}

function hall() {
  const prisma = new FakeTestsPrisma(
    [makeTest({ id: TEST, baseConfigId: 'cfg_1', status: TEST_STATUS.ACTIVE, isLocked: true })],
    [
      makeBaseConfig({
        id: 'cfg_1',
        durationSec: 1800,
        totalQuestions: 2,
        languages: [LANGUAGE_CODE.EN],
      }),
    ],
    SECTIONS,
    [],
    [makeQuestion({ id: 'q1' }), makeQuestion({ id: 'q2' })],
    paperRows(),
    [],
    [],
    [],
    [version('q1_v1', 'q1_v1_b'), version('q2_v1', 'q2_v1_a')],
  );
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma.asService(), redis.asService());
  const queue = new FakeQueue();
  const reach = {
    assertCanStart: () => Promise.resolve(),
    assertReachable: () => Promise.resolve(),
    extraTimeSecFor: () => Promise.resolve(0),
    invalidateStudent: () => Promise.resolve(),
  } as never;

  return {
    prisma,
    redis,
    state,
    queue,
    attempts: new AttemptsService(prisma.asService(), reach, state),
    paper: new AttemptPaperService(prisma.asService(), reach, noStorage()),
    flusher: new AttemptFlushProcessor(prisma.asService(), state),
    submit: new SubmitService(
      prisma.asService(),
      state,
      reach,
      new ScoringOutbox(prisma.asService(), queue.asQueue()),
      new FakeMetrics().asService(),
    ),
  };
}

/** No image is signed in these fixtures; a call would mean the paper started carrying one. */
const noStorage = () =>
  ({ createDownloadUrl: () => Promise.reject(new Error('unexpected sign')) }) as never;

const answer = (questionId: string, optionId: string): AnswerChange => ({
  questionId,
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: optionId,
  typedAnswer: null,
  timeSpentSec: 20,
});

describe('a sitting, end to end', () => {
  it('offers the test in the catalog and starts the very test it offered', async () => {
    const catalog = await catalogue().catalog(STUDENT);
    const offered = catalog.series.flatMap((series) => series.tests);

    assert.deepEqual(
      offered.map((test) => test.id),
      [TEST],
    );
    assert.equal(offered[0]?.canStart, true);

    const { attempts } = hall();
    const started = await attempts.start(STUDENT, TEST, {});

    assert.equal(started.testId, TEST);
    assert.equal(started.status, ATTEMPT_STATUS.IN_PROGRESS);
    // The request said nothing about timing: the deadline is the config's duration past the start.
    assert.equal(Date.parse(started.endsAt) - Date.parse(started.startedAt), 1800 * 1000);
  });

  it('serves a paper with the skin to draw it in and nothing that says the answer', async () => {
    const { attempts, paper } = hall();
    const started = await attempts.start(STUDENT, TEST, {});

    const served = await paper.paper(STUDENT, started.id);

    assert.equal(served.examTemplate, EXAM_TEMPLATE.COMFORTABLE);
    assert.equal(served.questions.length, 2);
    // The failure this prevents: `isCorrect` or a solution riding along to the browser.
    const serialized = JSON.stringify(served);
    assert.ok(!serialized.includes('isCorrect'));
    assert.ok(!serialized.includes('Because.'));
  });

  it('takes a hundred answers without writing Postgres once', async () => {
    const { attempts, state, redis, prisma } = hall();
    const started = await attempts.start(STUDENT, TEST, {});
    const durable = () =>
      prisma.attemptQuestions
        .filter((row) => row.attemptId === started.id)
        .map((row) => [row.state, row.selectedOptionId, row.timeSpentSec]);
    const seeded = durable();

    await state.save(STUDENT, started.id, { revision: 1, answers: [answer('q1', 'q1_v1_b')] });
    await state.save(STUDENT, started.id, { revision: 2, answers: [answer('q2', 'q2_v1_a')] });

    const live = await state.read(started.id);
    assert.equal(live?.answers.q1?.selectedOptionId, 'q1_v1_b');
    assert.equal(live?.answers.q2?.selectedOptionId, 'q2_v1_a');
    assert.ok(Object.keys(redis.snapshot()).some((key) => key.includes(started.id)));
    // The rows are exactly as `start` seeded them: the answer path never reached Postgres.
    assert.deepEqual(durable(), seeded);
  });

  it('writes what Redis held when the flusher runs', async () => {
    const { attempts, state, prisma, flusher } = hall();
    const started = await attempts.start(STUDENT, TEST, {});
    await state.save(STUDENT, started.id, { revision: 1, answers: [answer('q1', 'q1_v1_b')] });

    await flusher.process();

    const row = prisma.attemptQuestions.find(
      (it) => it.attemptId === started.id && it.questionId === 'q1',
    );
    assert.equal(row?.state, ANSWER_STATE.ANSWERED);
    assert.equal(row?.selectedOptionId, 'q1_v1_b');
    assert.equal(row?.timeSpentSec, 20);
  });

  it('ends the sitting once and asks for a score exactly once', async () => {
    const { attempts, state, submit, queue, prisma } = hall();
    const started = await attempts.start(STUDENT, TEST, {});
    await state.save(STUDENT, started.id, { revision: 1, answers: [answer('q1', 'q1_v1_b')] });

    const first = await submit.submit(STUDENT, started.id);
    const second = await submit.submit(STUDENT, started.id);

    assert.equal(first.submittedByThisCall, true);
    assert.equal(first.answeredCount, 1);
    // The failure this prevents: a double-click scoring the same paper twice.
    assert.equal(second.submittedByThisCall, false);
    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0]?.name, QUEUE_NAMES.SCORING);
    assert.equal(
      prisma.attemptRows.find((row) => row.id === started.id)?.status,
      ATTEMPT_STATUS.SUBMITTED,
    );
  });
});
