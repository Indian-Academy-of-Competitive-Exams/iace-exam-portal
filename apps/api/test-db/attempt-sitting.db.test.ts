import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  DEFAULT_EXAM_COURSE,
  EXAM_TEMPLATE,
  LANGUAGE_CODE,
  TEST_STATUS,
  type AnswerChange,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AttemptFlushProcessor } from '../src/attempts/attempt-flush.processor';
import { AttemptPaperService } from '../src/attempts/attempt-paper.service';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptsService } from '../src/attempts/attempts.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { ScoringOutbox } from '../src/attempts/scoring-outbox';
import { SubmitService } from '../src/attempts/submit.service';
import { QUEUE_NAMES } from '../src/queue/queues';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeMetrics, FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import {
  makeBranch,
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  testPrisma,
} from './support/database';

const SOLUTION = 'Because.';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** No image is resolved in these fixtures; a call would mean the paper started carrying one. */
const noStorage = () =>
  ({
    publicUrl: () => {
      throw new Error('unexpected image');
    },
  }) as never;

/** A student at a branch the series is switched on for, and one ACTIVE, frozen test in it. */
async function hall(questionCount = 2) {
  const branch = (await makeBranch(prisma)).id;
  const question = {
    subject: 'Reasoning',
    content: {
      en: {
        stem: [{ type: 'TEXT', text: 'What comes next?' }],
        solution: [{ type: 'TEXT', text: SOLUTION }],
      },
    },
  };
  const paper = await makePaper(prisma, {
    questions: Array.from({ length: questionCount }, () => question),
  });
  await prisma.baseConfig.update({
    where: { id: paper.catalog.baseConfigId },
    data: { durationSec: 1800, totalQuestions: questionCount, languages: [LANGUAGE_CODE.EN] },
  });
  await prisma.testSeries.update({
    where: { id: paper.catalog.testSeriesId },
    data: { isEnabled: true, branchIds: [branch] },
  });
  await prisma.test.update({
    where: { id: paper.testId },
    data: { status: TEST_STATUS.ACTIVE, finalizedAt: new Date() },
  });
  const student = (
    await makeStudent(prisma, { currentBranchId: branch, enrolledCourses: [DEFAULT_EXAM_COURSE] })
  ).id;

  const redis = new FakeRedis();
  const access = new AccessResolverService(prisma, redis.asService());
  const state = new AttemptStateService(prisma, redis.asService());
  const queue = new FakeQueue();
  const papers = new PaperSheetService(prisma);
  const sheets = new AttemptSheetService(prisma, papers);
  return {
    paper,
    student,
    redis,
    state,
    queue,
    access,
    attempts: new AttemptsService(prisma, access, state, sheets),
    sheet: new AttemptPaperService(prisma, access, noStorage(), papers),
    flusher: new AttemptFlushProcessor(state, sheets, fakeQueueFailures()),
    submit: new SubmitService(
      prisma,
      state,
      access,
      new ScoringOutbox(prisma, queue.asQueue()),
      new FakeMetrics().asService(),
      sheets,
    ),
  };
}

const answer = (questionId: string, optionId: string): AnswerChange => ({
  questionId,
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: optionId,
  typedAnswer: null,
  timeSpentSec: 20,
});

const durable = async (attemptId: string) =>
  (await servedAnswers(prisma, attemptId))
    .map((row) => ({
      questionId: row.questionId,
      state: row.state,
      selectedOptionId: row.selectedOptionId,
      timeSpentSec: row.timeSpentSec,
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));

describe('a sitting, end to end', () => {
  it('offers the test in the catalog and starts the very test it offered', async () => {
    const { access, attempts, student, paper } = await hall();

    const offered = (await access.catalog(student)).series.flatMap((series) => series.tests);
    assert.deepEqual(
      offered.map((test) => test.id),
      [paper.testId],
    );
    assert.equal(offered[0]?.canStart, true);

    const started = await attempts.start(student, paper.testId, {});

    assert.equal(started.testId, paper.testId);
    assert.equal(started.status, ATTEMPT_STATUS.IN_PROGRESS);
    // The request said nothing about timing: the deadline is the config's duration past the start.
    assert.equal(Date.parse(started.endsAt) - Date.parse(started.startedAt), 1800 * 1000);
    const config = await prisma.baseConfig.findUniqueOrThrow({
      where: { id: paper.catalog.baseConfigId },
    });
    assert.equal(config.locked, true, 'the first sitting freezes the blueprint');
  });

  it('serves a paper with the skin to draw it in and nothing that says the answer', async () => {
    const { attempts, sheet, student, paper } = await hall();
    const started = await attempts.start(student, paper.testId, {});

    const served = await sheet.paper(student, started.id);

    assert.equal(served.examTemplate, EXAM_TEMPLATE.DEFAULT);
    assert.equal(served.questions.length, 2);
    // The failure this prevents: `isCorrect` or a solution riding along to the browser.
    const serialized = JSON.stringify(served);
    assert.ok(!serialized.includes('isCorrect'));
    assert.ok(!serialized.includes(SOLUTION));
  });

  it('takes answers without writing Postgres once, and writes what Redis held when the flusher runs', async () => {
    const { attempts, state, redis, flusher, student, paper } = await hall();
    const [first, second] = paper.items.map((item) => item.questionId);
    const started = await attempts.start(student, paper.testId, {});
    const seeded = await durable(started.id);

    await state.save(student, started.id, { revision: 1, answers: [answer(first ?? '', 'o2')] });
    await state.save(student, started.id, { revision: 2, answers: [answer(second ?? '', 'o1')] });

    const live = await state.read(started.id);
    assert.equal(live?.answers[first ?? '']?.selectedOptionId, 'o2');
    assert.equal(live?.answers[second ?? '']?.selectedOptionId, 'o1');
    assert.ok(Object.keys(redis.snapshot()).some((key) => key.includes(started.id)));
    assert.deepEqual(await durable(started.id), seeded);

    await flusher.process();

    const written = (await durable(started.id)).find((row) => row.questionId === first);
    assert.deepEqual(
      [written?.state, written?.selectedOptionId, written?.timeSpentSec],
      [ANSWER_STATE.ANSWERED, 'o2', 20],
    );
  });

  it('ends the sitting once and asks for a score exactly once', async () => {
    const { attempts, state, submit, queue, student, paper } = await hall();
    const started = await attempts.start(student, paper.testId, {});
    await state.save(student, started.id, {
      revision: 1,
      answers: [answer(paper.items[0]?.questionId ?? '', 'o2')],
    });

    const first = await submit.submit(student, started.id);
    const second = await submit.submit(student, started.id);

    assert.equal(first.submittedByThisCall, true);
    assert.equal(first.answeredCount, 1);
    // The failure this prevents: a double-click scoring the same paper twice.
    assert.equal(second.submittedByThisCall, false);
    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0]?.name, QUEUE_NAMES.SCORING);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: started.id } });
    assert.equal(row.status, ATTEMPT_STATUS.SUBMITTED);
  });

  /** The bug this prevents: a Redis restart between the flush and a reload nulling out the sheet. */
  it('resumes from Postgres rather than blanking the sheet when the key was lost', async () => {
    const { attempts, state, redis, flusher, submit, student, paper } = await hall(3);
    const [first, second, third] = paper.items.map((item) => item.questionId);
    const started = await attempts.start(student, paper.testId, {});

    await state.save(student, started.id, { revision: 1, answers: [answer(first ?? '', 'o2')] });
    await state.save(student, started.id, { revision: 2, answers: [answer(second ?? '', 'o1')] });
    await flusher.process();

    await redis.del(redisKeys.attemptState(started.id));

    const resumed = await attempts.start(student, paper.testId, {});
    assert.equal(resumed.startedByThisCall, false);
    await state.save(student, started.id, { revision: 1, answers: [answer(third ?? '', 'o3')] });

    const result = await submit.submit(student, started.id);

    assert.equal(result.answeredCount, 3);
    const sheet = await servedAnswers(prisma, started.id);
    assert.deepEqual(
      new Map(sheet.map((row) => [row.questionId, row.selectedOptionId])),
      new Map([
        [first, 'o2'],
        [second, 'o1'],
        [third, 'o3'],
      ]),
    );
  });
});
