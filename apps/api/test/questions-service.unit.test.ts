import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_SOURCE_KIND,
  QUESTION_STATUS,
  QUESTION_TYPE,
  plainTextOf,
  questionDraftSchema,
  questionListQuerySchema,
  type QuestionDraftInput,
  type QuestionListQueryInput,
} from '@iace/contracts';
import { QuestionsService } from '../src/questions/questions.service';
import { TaxonomyService } from '../src/questions/taxonomy.service';
import {
  FakeQuestionBankPrisma,
  makeQuestion,
  makeSubTopic,
  makeSubject,
  makeTopic,
} from './support/fakes';

const ADMIN = 'adm_1';

function build(questions = [] as ReturnType<typeof makeQuestion>[]) {
  const prisma = new FakeQuestionBankPrisma(
    questions,
    [makeSubject(), makeSubject({ id: 'sub_2', name: 'GENERAL AWARENESS' })],
    [makeTopic(), makeTopic({ id: 'top_2', name: 'ALGEBRA' })],
    [makeSubTopic()],
  );

  return {
    prisma,
    questions: new QuestionsService(prisma.asService()),
    taxonomy: new TaxonomyService(prisma.asService()),
  };
}

/** Parsed by the same schema the controller's ZodQuery applies. */
const listQuery = (over: QuestionListQueryInput = {}) => questionListQuerySchema.parse(over);

/** The same shape the form posts, parsed by the same schema the controller uses. */
function draft(over: Partial<QuestionDraftInput> = {}) {
  return questionDraftSchema.parse({
    subjectId: 'sub_1',
    topicId: 'top_1',
    subTopicId: 'stp_1',
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

describe('QuestionsService.create', () => {
  it('writes the content nodes, the options and where it came from', async () => {
    const { questions, prisma } = build();

    const created = await questions.create(draft(), ADMIN);

    assert.equal(created.subject.name, 'QUANTITATIVE APTITUDE');
    assert.deepEqual(created.languages, ['en', 'hi']);
    assert.equal(plainTextOf(created.content.en?.stem), 'What is 20% of 150?');
    assert.equal(created.options.length, 4);
    assert.equal(created.options[1]?.isCorrect, true);
    assert.equal(created.source?.kind, QUESTION_SOURCE_KIND.MANUAL);
    assert.equal(prisma.questions[0]?.createdById, ADMIN);
    assert.ok(prisma.questions[0]?.stemHash);
  });

  it('refuses a question whose sub-topic is not under its topic, naming the field', async () => {
    const { questions } = build();

    await assert.rejects(
      () => questions.create(draft({ topicId: 'top_2' }), ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.subTopicId);
        return true;
      },
    );
  });

  it('refuses the same question twice — the failure the bank exists to prevent', async () => {
    const { questions } = build();
    const first = await questions.create(draft(), ADMIN);

    await assert.rejects(
      // Same question, options reordered and retyped: still the same question.
      () =>
        questions.create(
          draft({
            stem: { en: '  what is 20% OF 150 ', hi: '150 का 20% कितना है?' },
            options: [
              { position: 1, isCorrect: true, text: { en: '30', hi: '30' } },
              { position: 2, isCorrect: false, text: { en: '25', hi: '25' } },
              { position: 3, isCorrect: false, text: { en: '40', hi: '40' } },
              { position: 4, isCorrect: false, text: { en: '35', hi: '35' } },
            ],
          }),
          ADMIN,
        ),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.deepEqual(error.details, { duplicateOf: first.id });
        return true;
      },
    );
  });

  it('lets an unrelated question through', async () => {
    const { questions } = build();
    await questions.create(draft(), ADMIN);
    const second = await questions.create(
      draft({
        stem: { en: 'What is 30% of 150?' },
        options: [
          { position: 1, isCorrect: false, text: { en: '35' } },
          { position: 2, isCorrect: true, text: { en: '45' } },
          { position: 3, isCorrect: false, text: { en: '55' } },
          { position: 4, isCorrect: false, text: { en: '65' } },
        ],
      }),
      ADMIN,
    );
    assert.ok(second.id);
  });
});

describe('QuestionsService — retiring and status', () => {
  it('retires a question without deleting it', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft(), ADMIN);

    const retired = await questions.setActive(created.id, { isActive: false });

    assert.equal(retired.isActive, false);
    assert.equal(prisma.questions.length, 1);
  });

  it('hides a retired question from the bank while an unfiltered list still counts it', async () => {
    const { questions } = build([
      makeQuestion({ id: 'q_live' }),
      makeQuestion({ id: 'q_dead', isActive: false, stemHash: 'hash_2' }),
    ]);

    const active = await questions.list(listQuery({ isActive: 'true' }));
    assert.deepEqual(
      active.items.map((item) => item.id),
      ['q_live'],
    );

    const all = await questions.list(listQuery());
    assert.equal(all.total, 2);
  });

  it('moves a question to a status the bank filters on', async () => {
    const { questions } = build();
    const created = await questions.create(draft(), ADMIN);

    const archived = await questions.setStatus(created.id, { status: QUESTION_STATUS.ARCHIVED });
    assert.equal(archived.status, QUESTION_STATUS.ARCHIVED);
  });

  it('answers NOT_FOUND for a question that is not there', async () => {
    const { questions } = build();
    await assert.rejects(
      () => questions.detail('nope'),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('QuestionsService.update', () => {
  it('replaces the options rather than adding to them', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft(), ADMIN);

    const updated = await questions.update(
      created.id,
      draft({
        stem: { en: 'What is 20% of 150?' },
        options: [
          { position: 1, isCorrect: false, text: { en: '20' } },
          { position: 2, isCorrect: true, text: { en: '30' } },
          { position: 3, isCorrect: false, text: { en: '45' } },
          { position: 4, isCorrect: false, text: { en: '50' } },
        ],
      }),
    );

    assert.equal(updated.options.length, 4);
    assert.equal(prisma.options.filter((option) => option.questionId === created.id).length, 4);
  });

  it('does not call a question a duplicate of itself', async () => {
    const { questions } = build();
    const created = await questions.create(draft(), ADMIN);

    const updated = await questions.update(
      created.id,
      draft({ difficulty: DIFFICULTY_LEVEL.HIGH }),
    );
    assert.equal(updated.difficulty, DIFFICULTY_LEVEL.HIGH);
  });
});

describe('TaxonomyService — the shared third level', () => {
  it('links an existing sub-topic instead of minting a second row with the same name', async () => {
    // A second PERCENTAGES would split the per-sub-topic analytics the sharing exists to join up.
    const { taxonomy, prisma } = build();

    const linked = await taxonomy.createSubTopic({ name: 'PERCENTAGES', topicIds: ['top_2'] });

    assert.equal(prisma.subTopics.length, 1);
    assert.deepEqual(linked.topics.map((topic) => topic.id).sort(), ['top_1', 'top_2']);
  });

  it('creates a sub-topic nobody has used yet', async () => {
    const { taxonomy, prisma } = build();

    await taxonomy.createSubTopic({ name: 'RATIOS', topicIds: ['top_1'] });

    assert.equal(prisma.subTopics.length, 2);
  });

  it('refuses to link a topic that is not there', async () => {
    const { taxonomy } = build();

    await assert.rejects(
      () => taxonomy.createSubTopic({ name: 'RATIOS', topicIds: ['top_missing'] }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('refuses a second subject with the same name', async () => {
    const { taxonomy } = build();

    await assert.rejects(
      () => taxonomy.createSubject({ name: 'QUANTITATIVE APTITUDE' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.name);
        return true;
      },
    );
  });
});

describe('QuestionsService.list', () => {
  it('filters by subject and pages', async () => {
    const { questions } = build([
      makeQuestion({ id: 'q1', stemHash: 'h1' }),
      makeQuestion({ id: 'q2', subjectId: 'sub_2', stemHash: 'h2' }),
      makeQuestion({ id: 'q3', stemHash: 'h3' }),
    ]);

    const page = await questions.list(listQuery({ pageSize: 2, subjectId: 'sub_1' }));

    assert.equal(page.total, 2);
    assert.equal(page.items.length, 2);
    assert.equal(page.pageSize, 2);
    assert.ok(page.items.every((item) => item.subject.id === 'sub_1'));
  });

  it('carries the English stem and the languages into the row', async () => {
    const { questions } = build();
    await questions.create(draft(), ADMIN);

    const page = await questions.list(listQuery());

    assert.equal(page.items[0]?.stemPreview, 'What is 20% of 150?');
    assert.deepEqual(page.items[0]?.languages, ['en', 'hi']);
    assert.equal(page.items[0]?.type, QUESTION_TYPE.SINGLE_MCQ);
  });
});
