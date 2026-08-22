import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
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
import { AuditContext } from '../src/audit';
import {
  FakeQuestionBankPrisma,
  FakeStorage,
  makeQuestion,
  makeSubject,
  makeTopic,
} from './support/fakes';

const ADMIN = 'adm_1';

function build(questions = [] as ReturnType<typeof makeQuestion>[]) {
  const prisma = new FakeQuestionBankPrisma(
    questions,
    [makeSubject(), makeSubject({ id: 'sub_2', name: 'GENERAL AWARENESS' })],
    [
      makeTopic(),
      makeTopic({ id: 'top_2', name: 'ALGEBRA' }),
      makeTopic({ id: 'top_3', name: 'HISTORY', subjectId: 'sub_2' }),
    ],
  );

  return {
    prisma,
    questions: new QuestionsService(
      prisma.asService(),
      new AuditContext(),
      new FakeStorage() as never,
    ),
    taxonomy: new TaxonomyService(prisma.asService(), new AuditContext()),
  };
}

/** Parsed by the same schema the controller's ZodQuery applies. */
const listQuery = (over: QuestionListQueryInput = {}) => questionListQuerySchema.parse(over);

/** The same shape the form posts, parsed by the same schema the controller uses. */
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

describe('QuestionsService.create', () => {
  it('writes the content nodes and the options as version one', async () => {
    const { questions, prisma } = build();

    const created = await questions.create(draft(), ADMIN);

    assert.equal(created.subject.name, 'QUANTITATIVE APTITUDE');
    assert.deepEqual(created.languages, ['en', 'hi']);
    assert.equal(plainTextOf(created.content.en?.stem), 'What is 20% of 150?');
    assert.equal(created.options.length, 4);
    assert.equal(created.options[1]?.isCorrect, true);
    assert.equal(created.version, 1);
    assert.equal(prisma.questions[0]?.createdById, ADMIN);
    assert.ok(prisma.questions[0]?.stemHash);
  });

  it('refuses a question whose topic is not under its subject, naming the field', async () => {
    const { questions } = build();

    await assert.rejects(
      () => questions.create(draft({ topicId: 'top_3' }), ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.topicId);
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

    const archived = await questions.setStatus(created.id, { status: QUESTION_STATUS.ARCHIVED });

    assert.equal(archived.status, QUESTION_STATUS.ARCHIVED);
    assert.equal(prisma.questions.length, 1);
  });

  it('hides a retired question from the bank while an unfiltered list still counts it', async () => {
    const { questions } = build([
      makeQuestion({ id: 'q_live' }),
      makeQuestion({ id: 'q_dead', status: QUESTION_STATUS.ARCHIVED, stemHash: 'hash_2' }),
    ]);

    const active = await questions.list(listQuery({ status: QUESTION_STATUS.ACTIVE }));
    assert.deepEqual(
      active.items.map((item) => item.id),
      ['q_live'],
    );

    const all = await questions.list(listQuery());
    assert.equal(all.total, 2);
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
    const { questions } = build();
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
      ADMIN,
    );

    assert.equal(updated.options.length, 4);
    assert.deepEqual(
      updated.options.map((option) => plainTextOf(option.text.en)),
      ['20', '30', '45', '50'],
    );
  });

  it('does not call a question a duplicate of itself', async () => {
    const { questions } = build();
    const created = await questions.create(draft(), ADMIN);

    const updated = await questions.update(
      created.id,
      draft({ difficulty: DIFFICULTY_LEVEL.HIGH }),
      ADMIN,
    );
    assert.equal(updated.difficulty, DIFFICULTY_LEVEL.HIGH);
  });
});

describe('QuestionsService.update — what versioning is for', () => {
  /**
   * A paper and an attempt pin a version. If an edit rewrote the row they point at, every result
   * already scored would silently start reading as a question nobody ever sat.
   */
  it('inserts a new version and leaves the one a paper already pinned untouched', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft(), ADMIN);

    const pinned = prisma.versions[0]!;
    const pinnedContent = JSON.stringify(pinned.content);
    const pinnedOptions = JSON.stringify(pinned.options);

    const edited = await questions.update(
      created.id,
      draft({ stem: { en: 'What is 20% of 150, rounded?', hi: '150 का 20% कितना है?' } }),
      ADMIN,
    );

    assert.equal(edited.version, 2);
    assert.equal(prisma.versions.length, 2);
    assert.equal(JSON.stringify(pinned.content), pinnedContent);
    assert.equal(JSON.stringify(pinned.options), pinnedOptions);
    assert.notEqual(prisma.questions[0]?.currentVersionId, pinned.id);
  });

  /**
   * An attempt stores the option id it was shown, so an id that churned on a save would orphan
   * every answer already recorded against that slot.
   */
  it('keeps an option id across an edit when its position is unchanged', async () => {
    const { questions } = build();
    const created = await questions.create(draft(), ADMIN);

    const edited = await questions.update(
      created.id,
      draft({
        stem: { en: 'What is 20% of 150, exactly?' },
        options: [
          { position: 1, isCorrect: false, text: { en: 'twenty five' } },
          { position: 2, isCorrect: true, text: { en: 'thirty' } },
          { position: 3, isCorrect: false, text: { en: 'thirty five' } },
          { position: 4, isCorrect: false, text: { en: 'forty' } },
        ],
      }),
      ADMIN,
    );

    assert.ok(created.options.every((option) => option.id.length > 0));
    assert.deepEqual(
      edited.options.map((option) => option.id),
      created.options.map((option) => option.id),
    );
  });

  /**
   * The failure this prevents: `status` used to default to ACTIVE on the draft, so any save that
   * did not name it put an archived question back into circulation — and back into the next paper.
   */
  it('leaves an archived question archived when the save does not name a status', async () => {
    const { questions } = build();
    const created = await questions.create(draft(), ADMIN);
    await questions.setStatus(created.id, { status: QUESTION_STATUS.ARCHIVED });

    const edited = await questions.update(created.id, draft({ questionCode: 'QA-002' }), ADMIN);

    assert.equal(edited.status, QUESTION_STATUS.ARCHIVED);
  });
});

describe('TaxonomyService', () => {
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

describe('saveImage', () => {
  it('stores the bytes and hands back the key, plus a url to show it with', async () => {
    const storage = new FakeStorage();
    const questions = new QuestionsService(
      build().prisma.asService(),
      new AuditContext(),
      storage as never,
    );

    const saved = await questions.saveImage({
      buffer: Buffer.from('png-bytes'),
      size: 9,
      mimetype: 'image/png',
    });

    assert.ok(saved.key.startsWith('questions/images/'));
    assert.equal(storage.objects.get(saved.key)?.toString(), 'png-bytes');
    assert.ok(saved.url.includes(saved.key), 'the url has to point at what was just stored');
  });

  /** Content quotes the key; a rejected upload must not leave one behind for it to quote. */
  it('refuses before it uploads, so a bad file leaves nothing in the bucket', async () => {
    const storage = new FakeStorage();
    const questions = new QuestionsService(
      build().prisma.asService(),
      new AuditContext(),
      storage as never,
    );

    await assert.rejects(() =>
      questions.saveImage({ buffer: Buffer.from('<svg/>'), size: 6, mimetype: 'image/svg+xml' }),
    );
    assert.equal(storage.objects.size, 0);
  });
});
