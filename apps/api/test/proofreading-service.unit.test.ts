import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_FLAG_CATEGORY,
  QUESTION_FLAG_STATUS,
  QUESTION_STATUS,
  questionDraftSchema,
  questionListQuerySchema,
  type QuestionDraftInput,
} from '@iace/contracts';
import { ProofreadingService } from '../src/questions/proofreading.service';
import { QuestionsService } from '../src/questions/questions.service';
import { AuditContext } from '../src/audit';
import {
  FakeQuestionBankPrisma,
  FakeStorage,
  makeQuestionFlag,
  makeSubject,
  makeTopic,
} from './support/fakes';

const REVIEWER = 'adm_reviewer';
const AUTHOR = 'adm_author';

function build() {
  const prisma = new FakeQuestionBankPrisma([], [makeSubject()], [makeTopic()]);
  prisma.admins.push({ id: REVIEWER, fullName: 'Reviewer', email: 'reviewer@iace.co.in' });

  const questions = new QuestionsService(
    prisma.asService(),
    new AuditContext(),
    new FakeStorage() as never,
  );

  return {
    prisma,
    questions,
    proofreading: new ProofreadingService(prisma.asService(), questions),
  };
}

function draft(over: Partial<QuestionDraftInput> = {}) {
  return questionDraftSchema.parse({
    subjectId: 'sub_1',
    topicId: 'top_1',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    stem: { en: 'What is 20% of 150?', hi: '150 का 20% कितना है?' },
    options: [
      { position: 1, isCorrect: false, text: { en: '25', hi: '25' } },
      { position: 2, isCorrect: true, text: { en: '30', hi: '30' } },
      { position: 3, isCorrect: false, text: { en: '35', hi: '35' } },
      { position: 4, isCorrect: false, text: { en: '40', hi: '40' } },
    ],
    ...over,
  });
}

const anyQuestion = questionListQuerySchema.parse({});

describe('ProofreadingService.document', () => {
  it('hands back each question in full, with every flag raised on it', async () => {
    const { proofreading, questions, prisma } = build();
    const created = await questions.create(draft(), AUTHOR);
    prisma.flags.push(makeQuestionFlag({ questionId: created.id, raisedById: REVIEWER }));

    const page = await proofreading.document(anyQuestion);

    const [question] = page.items;
    assert.equal(page.total, 1);
    assert.deepEqual(question?.languages, ['en', 'hi']);
    assert.equal(question?.options.length, 4);
    assert.equal(question?.flags.length, 1);
    assert.equal(question?.flags[0]?.raisedBy?.name, 'Reviewer');
  });

  /** A reviewer reads the whole question, answer key included — this is not an attempt. */
  it('carries the answer through, so a reviewer reads what a candidate never sees', async () => {
    const { proofreading, questions } = build();
    await questions.create(draft({ solution: { en: '150 × 0.2 = 30.' } }), AUTHOR);

    const page = await proofreading.document(anyQuestion);

    assert.ok(page.items[0]?.options.some((option) => option.isCorrect));
    assert.ok(page.items[0]?.content.en?.solution);
  });

  it('narrows to the filtered selection rather than the whole bank', async () => {
    const { proofreading, questions } = build();
    await questions.create(draft(), AUTHOR);
    await questions.create(
      draft({
        status: QUESTION_STATUS.ACTIVE,
        stem: { en: 'What is 25% of 200?', hi: '200 का 25% कितना है?' },
      }),
      AUTHOR,
    );

    const page = await proofreading.document(
      questionListQuerySchema.parse({ status: QUESTION_STATUS.DRAFT }),
    );

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.status, QUESTION_STATUS.DRAFT);
  });

  /** A reader's flags gate ACTIVATION, so a live question is past the point their reading changes. */
  it('leaves a live question out even when nothing was filtered', async () => {
    const { proofreading, questions } = build();
    await questions.create(draft(), AUTHOR);
    await questions.create(
      draft({
        status: QUESTION_STATUS.ACTIVE,
        stem: { en: 'What is 25% of 200?', hi: '200 का 25% कितना है?' },
      }),
      AUTHOR,
    );

    const page = await proofreading.document(anyQuestion);

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.status, QUESTION_STATUS.DRAFT);
  });

  /** Forced rather than filtered: a hand-edited URL must not widen the document. */
  it('leaves a live question out even when the query asks for one', async () => {
    const { proofreading, questions } = build();
    await questions.create(
      draft({
        status: QUESTION_STATUS.ACTIVE,
        stem: { en: 'What is 25% of 200?', hi: '200 का 25% कितना है?' },
      }),
      AUTHOR,
    );

    const page = await proofreading.document(
      questionListQuerySchema.parse({ status: QUESTION_STATUS.ACTIVE }),
    );

    assert.equal(page.total, 0);
  });
});

describe('ProofreadingService — raising and settling', () => {
  it('pins the version the reviewer was reading', async () => {
    const { proofreading, questions, prisma } = build();
    const created = await questions.create(draft(), AUTHOR);

    const flag = await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.INVALID, comment: 'The key is wrong.' },
      REVIEWER,
    );

    assert.equal(flag.status, QUESTION_FLAG_STATUS.OPEN);
    assert.equal(flag.onCurrentVersion, true);
    assert.equal(prisma.flags[0]?.versionId, prisma.questions[0]?.currentVersionId);
  });

  it('records who settled it and when', async () => {
    const { proofreading, questions, prisma } = build();
    const created = await questions.create(draft(), AUTHOR);
    const raised = await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.OTHER, comment: 'Check the units.' },
      REVIEWER,
    );

    const settled = await proofreading.settle(
      raised.id,
      { status: QUESTION_FLAG_STATUS.RESOLVED },
      REVIEWER,
    );

    assert.equal(settled.status, QUESTION_FLAG_STATUS.RESOLVED);
    assert.equal(settled.resolvedBy?.name, 'Reviewer');
    assert.ok(settled.resolvedAt);
    assert.equal(prisma.flags[0]?.status, QUESTION_FLAG_STATUS.RESOLVED);
  });

  /** Two reviewers on one document: the second answer must not overwrite the first. */
  it('refuses to settle a flag somebody has already settled', async () => {
    const { proofreading, questions } = build();
    const created = await questions.create(draft(), AUTHOR);
    const raised = await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.TOO_DIFFICULT, comment: 'Out of scope.' },
      REVIEWER,
    );
    await proofreading.settle(raised.id, { status: QUESTION_FLAG_STATUS.DISMISSED }, REVIEWER);

    await assert.rejects(
      () => proofreading.settle(raised.id, { status: QUESTION_FLAG_STATUS.RESOLVED }, REVIEWER),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('refuses a flag on a question that is not there', async () => {
    const { proofreading } = build();

    await assert.rejects(
      () =>
        proofreading.raise(
          'gone',
          { category: QUESTION_FLAG_CATEGORY.OTHER, comment: 'Nothing to read.' },
          REVIEWER,
        ),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});
