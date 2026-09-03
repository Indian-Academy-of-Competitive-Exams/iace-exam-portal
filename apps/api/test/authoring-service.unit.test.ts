import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reflector } from '@nestjs/core';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
  authoringHistoryQuerySchema,
  questionDraftSchema,
  type AuthoringHistoryQueryInput,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuthoringController } from '../src/questions/authoring.controller';
import { AuthoringService } from '../src/questions/authoring.service';
import { QuestionsService } from '../src/questions/questions.service';
import { QuestionsController } from '../src/questions/questions.controller';
import { TaxonomyController } from '../src/questions/taxonomy.controller';
import { AuditContext } from '../src/audit';
import { REQUIRED_FEATURE_KEY, type RequiredFeature } from '../src/common/security';
import {
  FakeQuestionBankPrisma,
  FakeStorage,
  makeQuestion,
  makeSubject,
  makeTopic,
  rowAt,
} from './support/fakes';

/** What `getAllAndOverride` takes: a handler or the class it hangs off. */
type Reflected = Parameters<Reflector['getAllAndOverride']>[1][number];

const MINE = 'adm_mine';
const THEIRS = 'adm_theirs';

function build(questions = [] as ReturnType<typeof makeQuestion>[]) {
  const prisma = new FakeQuestionBankPrisma(
    questions,
    [makeSubject(), makeSubject({ id: 'sub_2', name: 'GENERAL AWARENESS' })],
    [makeTopic(), makeTopic({ id: 'top_3', name: 'HISTORY', subjectId: 'sub_2' })],
  );

  const questionsService = new QuestionsService(
    prisma.asService(),
    new AuditContext(),
    new FakeStorage() as never,
  );

  return { prisma, authoring: new AuthoringService(prisma.asService(), questionsService) };
}

const draft = (over: Partial<QuestionDraftInput> = {}) =>
  questionDraftSchema.parse({
    subjectId: 'sub_1',
    topicId: 'top_1',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    stem: { en: 'What is 20% of 150?' },
    options: [
      { position: 1, isCorrect: false, text: { en: '25' } },
      { position: 2, isCorrect: true, text: { en: '30' } },
      { position: 3, isCorrect: false, text: { en: '35' } },
      { position: 4, isCorrect: false, text: { en: '40' } },
    ],
    ...over,
  });

const query = (over: AuthoringHistoryQueryInput = {}) => authoringHistoryQuerySchema.parse(over);

describe('AuthoringService.create', () => {
  it('writes a DRAFT question and its first version, credited to the author', async () => {
    const { authoring, prisma } = build();

    const { question } = await authoring.create(draft(), MINE);

    assert.equal(question.status, QUESTION_STATUS.DRAFT);
    assert.equal(question.version, 1);
    assert.equal(prisma.questions[0]?.createdById, MINE);
    assert.equal(prisma.versions.length, 1);
  });

  it('lands as a DRAFT even when the body asks for something else', async () => {
    const { authoring } = build();

    const { question } = await authoring.create(draft({ status: QUESTION_STATUS.ACTIVE }), MINE);

    assert.equal(question.status, QUESTION_STATUS.DRAFT);
  });

  it('reports a near-duplicate and writes it anyway, unlike the bank', async () => {
    const { authoring } = build();
    const first = await authoring.create(draft(), MINE);

    const second = await authoring.create(draft(), MINE);

    assert.equal(second.duplicateOf?.id, first.question.id);
    assert.equal(second.duplicateOf?.stemPreview, 'What is 20% of 150?');
    assert.ok(second.question.id);
  });

  it('says nothing about a duplicate when there is not one', async () => {
    const { authoring } = build();

    const { duplicateOf } = await authoring.create(draft(), MINE);

    assert.equal(duplicateOf, null);
  });

  it('refuses a question the shared rules refuse, on the same codes', async () => {
    const { authoring } = build();

    await assert.rejects(
      () => authoring.create(draft({ stem: {} }), MINE),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.['stem.en']);
        return true;
      },
    );
  });
});

describe('AuthoringService.history', () => {
  it("shows the author their own work and nobody else's", async () => {
    const { authoring } = build([
      makeQuestion({ id: 'qst_mine', createdById: MINE, status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'qst_theirs', createdById: THEIRS, status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'qst_nobody', createdById: null }),
    ]);

    const page = await authoring.history(query(), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      ['qst_mine'],
    );
    assert.equal(page.total, 1);
  });

  it('lists the archived too, which the bank hides — it is a record of what was written', async () => {
    const { authoring } = build([
      makeQuestion({ id: 'qst_1', createdById: MINE, status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'qst_2', createdById: MINE, status: QUESTION_STATUS.ARCHIVED }),
    ]);

    const page = await authoring.history(query(), MINE);

    assert.equal(page.total, 2);
  });

  it('narrows to one state when the reader names one', async () => {
    const { authoring } = build([
      makeQuestion({ id: 'qst_1', createdById: MINE, status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'qst_2', createdById: MINE, status: QUESTION_STATUS.ACTIVE }),
    ]);

    const page = await authoring.history(query({ status: QUESTION_STATUS.DRAFT }), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      ['qst_1'],
    );
  });

  it('searches inside the author’s own rows, never past them', async () => {
    const { authoring, prisma } = build();
    await authoring.create(draft(), MINE);
    await authoring.create(draft({ stem: { en: 'Who wrote the Constitution?' } }), THEIRS);
    rowAt(prisma.questions, 1).createdById = THEIRS;

    const mine = await authoring.history(query({ q: 'Constitution' }), MINE);
    const theirs = await authoring.history(query({ q: 'Constitution' }), THEIRS);

    assert.equal(mine.total, 0);
    assert.equal(theirs.total, 1);
  });
});

describe('editing from the authoring screen', () => {
  it("will not open another author's question", async () => {
    const { authoring } = build([makeQuestion({ id: 'qst_1', createdById: THEIRS })]);

    await assert.rejects(
      () => authoring.detail('qst_1', MINE),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it("will not change another author's question either", async () => {
    const { authoring } = build([
      makeQuestion({ id: 'qst_1', createdById: THEIRS, status: QUESTION_STATUS.DRAFT }),
    ]);

    await assert.rejects(
      () => authoring.update('qst_1', draft(), MINE),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('hands a question that has left review back to the question bank', async () => {
    const { authoring } = build([
      makeQuestion({ id: 'qst_1', createdById: MINE, status: QUESTION_STATUS.ACTIVE }),
    ]);

    await assert.rejects(
      () => authoring.update('qst_1', draft(), MINE),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('revises the author’s own draft in place', async () => {
    const { authoring, prisma } = build();
    const created = await authoring.create(draft(), MINE);

    const { question } = await authoring.update(
      created.question.id,
      draft({ stem: { en: 'What is 20% of 250?' } }),
      MINE,
    );

    assert.equal(question.version, 1);
    assert.equal(question.status, QUESTION_STATUS.DRAFT);
    assert.equal(prisma.versions.length, 1);
  });
});

describe('what the authoring routes charge', () => {
  const reflector = new Reflector();
  const demanded = (handler: Reflected) =>
    reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
      handler,
      AuthoringController,
    ]);

  /** The failure this prevents: a typist reaching the bank because the nav was the only gate. */
  it('charges every route QUESTION_AUTHORING, at the level the act deserves', () => {
    const priced = [
      [AuthoringController.prototype.tags, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.stats, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.history, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.detail, PERMISSION_LEVELS.READ],
      [AuthoringController.prototype.create, PERMISSION_LEVELS.WRITE],
      [AuthoringController.prototype.update, PERMISSION_LEVELS.WRITE],
    ] as const;

    for (const [handler, level] of priced) {
      assert.deepEqual(demanded(handler), { key: FEATURE_KEYS.QUESTION_AUTHORING, level });
    }
  });

  it('opens the two reads both entry paths need to either key, and nothing else', () => {
    const both = [FEATURE_KEYS.QUESTION_MANAGEMENT, FEATURE_KEYS.QUESTION_AUTHORING];
    const shared = (handler: Reflected, target: Reflected) =>
      reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
        handler,
        target,
      ]);

    assert.deepEqual(shared(TaxonomyController.prototype.listSubjects, TaxonomyController), {
      key: both,
      level: PERMISSION_LEVELS.READ,
    });
    assert.deepEqual(shared(TaxonomyController.prototype.listTopics, TaxonomyController), {
      key: both,
      level: PERMISSION_LEVELS.READ,
    });
    assert.deepEqual(shared(QuestionsController.prototype.uploadImage, QuestionsController), {
      key: both,
      level: PERMISSION_LEVELS.WRITE,
    });

    // The bank itself stays the bank's: authoring is not a second door onto it.
    assert.deepEqual(shared(QuestionsController.prototype.list, QuestionsController), {
      key: FEATURE_KEYS.QUESTION_MANAGEMENT,
      level: PERMISSION_LEVELS.READ,
    });
  });
});
