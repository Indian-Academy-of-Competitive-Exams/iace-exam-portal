import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_STATUS,
  QUESTION_TYPE,
  plainTextOf,
  previewTextOf,
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

  const audit = new AuditContext();

  return {
    prisma,
    audit,
    questions: new QuestionsService(prisma.asService(), audit, new FakeStorage() as never),
    taxonomy: new TaxonomyService(prisma.asService(), new AuditContext()),
  };
}

/** The interceptor reads `changed` off the request-scoped store, so a test has to run inside one. */
function recording<T>(audit: AuditContext, work: () => Promise<T>) {
  return audit.run(async () => ({ result: await work(), changed: audit.current()?.changed }));
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
    assert.equal(previewTextOf(plainTextOf(created.content.en?.stem)), 'What is 20% of 150?');
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
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    const archived = await questions.archive(created.id);

    assert.equal(archived.status, QUESTION_STATUS.ARCHIVED);
    assert.equal(prisma.questions.length, 1);
  });

  it('puts a retired question back into circulation', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    await questions.archive(created.id);

    const back = await questions.unarchive(created.id);

    assert.equal(back.status, QUESTION_STATUS.ACTIVE);
  });

  /** A draft was never in circulation, so archiving it would be a second way to publish it. */
  it('refuses to archive a draft', async () => {
    const { questions } = build();
    const created = await questions.create(asDraft(), ADMIN);

    await assert.rejects(
      () => questions.archive(created.id),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  /** Out of circulation is out of the bank: a reader has to ask for the retired by name. */
  it('keeps a retired question out of the bank until it is asked for', async () => {
    const { questions } = build([
      makeQuestion({ id: 'q_live' }),
      makeQuestion({ id: 'q_dead', status: QUESTION_STATUS.ARCHIVED, stemHash: 'hash_2' }),
    ]);

    const bank = await questions.list(listQuery());
    assert.deepEqual(
      bank.items.map((item) => item.id),
      ['q_live'],
    );

    const retired = await questions.list(listQuery({ status: QUESTION_STATUS.ARCHIVED }));
    assert.deepEqual(
      retired.items.map((item) => item.id),
      ['q_dead'],
    );
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
      updated.options.map((option) => previewTextOf(plainTextOf(option.text.en))),
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
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

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
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    await questions.archive(created.id);

    const edited = await questions.update(created.id, draft({ questionCode: 'QA-002' }), ADMIN);

    assert.equal(edited.status, QUESTION_STATUS.ARCHIVED);
  });
});

const REWORDED = { en: 'What is 20% of 150, exactly?', hi: '150 का 20% कितना है?' };

const asDraft = (over: Partial<QuestionDraftInput> = {}) =>
  draft({ status: QUESTION_STATUS.DRAFT, ...over });

describe('QuestionsService.update — a draft is still being written', () => {
  /** A draft is a working copy: saving it ten times must not leave ten versions to read through. */
  it('rewrites the one version a draft already has', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(asDraft(), ADMIN);
    const versionId = prisma.questions[0]?.currentVersionId;

    const edited = await questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN);

    assert.equal(prisma.versions.length, 1);
    assert.equal(edited.version, 1);
    assert.equal(prisma.questions[0]?.currentVersionId, versionId);
    assert.equal(
      previewTextOf(plainTextOf(edited.content.en?.stem)),
      'What is 20% of 150, exactly?',
    );
  });

  /** Without a version bump to read, the trail would say a draft was saved and nothing else. */
  it('records what the draft now says, though its version number did not move', async () => {
    const { questions, audit } = build();
    const created = await questions.create(asDraft(), ADMIN);

    const { changed } = await recording(audit, () =>
      questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN),
    );

    assert.ok(changed?.content, 'the edit recorded no content change');
    assert.notEqual(changed.content.from, changed.content.to);
    assert.equal(changed.version, undefined);
  });

  /** Every word on the row can be the second admin's, so the row should not still credit the first. */
  it('credits the admin who rewrote the draft, not the one who opened it', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(asDraft(), ADMIN);

    await questions.update(created.id, asDraft({ stem: REWORDED }), 'adm_2');

    assert.equal(prisma.versions[0]?.createdById, 'adm_2');
  });

  /** An attempt stores the option id it was shown, and a revision is still an edit of that row. */
  it('keeps the option ids a revision inherits', async () => {
    const { questions } = build();
    const created = await questions.create(asDraft(), ADMIN);

    const edited = await questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN);

    assert.deepEqual(
      edited.options.map((option) => option.id),
      created.options.map((option) => option.id),
    );
  });

  it('versions a published question rather than rewriting it', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    const versionId = prisma.questions[0]?.currentVersionId;

    const edited = await questions.update(
      created.id,
      draft({ status: QUESTION_STATUS.ACTIVE, stem: REWORDED }),
      ADMIN,
    );

    assert.equal(edited.version, 2);
    assert.equal(prisma.versions.length, 2);
    assert.notEqual(prisma.questions[0]?.currentVersionId, versionId);
  });

  /** Status is the rule; this is the belt: a held version must not rewrite itself, ever. */
  for (const holder of ['paperRefs', 'attemptRefs'] as const) {
    it(`versions a draft whose version a ${holder === 'paperRefs' ? 'paper' : 'attempt'} holds`, async () => {
      const { questions, prisma } = build();
      const created = await questions.create(asDraft(), ADMIN);
      const versionId = prisma.questions[0]?.currentVersionId ?? '';
      prisma[holder].push({ questionId: created.id, questionVersionId: versionId });

      const edited = await questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN);

      assert.equal(edited.version, 2);
      assert.equal(prisma.versions.length, 2);
      assert.notEqual(prisma.questions[0]?.currentVersionId, versionId);
    });
  }

  /** Publishing is the freeze: what was revisable a moment ago now grows a version instead. */
  it('stops revising in place once the draft is published', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(asDraft(), ADMIN);
    await questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN);
    assert.equal(prisma.versions.length, 1);

    await questions.setStatus(created.id, { status: QUESTION_STATUS.ACTIVE });
    const published = await questions.update(
      created.id,
      draft({ status: QUESTION_STATUS.ACTIVE, stem: { en: 'What is 25% of 200?', hi: 'x' } }),
      ADMIN,
    );

    assert.equal(published.version, 2);
    assert.equal(prisma.versions.length, 2);
  });
});

describe('QuestionsService — publishing is one way', () => {
  const refused = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

  /** Back to draft would make an approved version a working copy the next edit overwrites. */
  it('refuses to send a published question back to draft', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    await assert.rejects(
      () => questions.setStatus(created.id, { status: QUESTION_STATUS.DRAFT }),
      refused,
    );
  });

  it('refuses the same thing through a save', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    await assert.rejects(
      () => questions.update(created.id, draft({ status: QUESTION_STATUS.DRAFT }), ADMIN),
      refused,
    );
    assert.equal(prisma.questions[0]?.status, QUESTION_STATUS.ACTIVE);
  });

  it('refuses to un-retire a question into draft', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    await questions.setStatus(created.id, { status: QUESTION_STATUS.ARCHIVED });

    await assert.rejects(
      () => questions.setStatus(created.id, { status: QUESTION_STATUS.DRAFT }),
      refused,
    );
  });

  /** A batch is one decision, so one published row in it refuses the batch rather than half-applying. */
  it('refuses a batch that would send a published question back to draft', async () => {
    const { questions, prisma } = build();
    const stillDraft = await questions.create(asDraft({ questionCode: 'QA-D' }), ADMIN);
    const published = await questions.create(
      draft({
        status: QUESTION_STATUS.ACTIVE,
        questionCode: 'QA-A',
        stem: { en: 'Another one?', hi: 'एक और?' },
      }),
      ADMIN,
    );

    await assert.rejects(
      () => questions.bulkSetStatus({ ids: [stillDraft.id, published.id], status: 'DRAFT' }),
      refused,
    );
    assert.equal(prisma.questions[0]?.status, QUESTION_STATUS.DRAFT);
  });

  /** The review screen approves a page of drafts at once, which must stay possible. */
  it('lets a batch of drafts be approved together', async () => {
    const { questions } = build([
      makeQuestion({ id: 'q_a', status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'q_b', status: QUESTION_STATUS.DRAFT, stemHash: 'hash_2' }),
    ]);

    const result = await questions.bulkSetStatus({
      ids: ['q_a', 'q_b'],
      status: QUESTION_STATUS.ACTIVE,
    });

    assert.equal(result.updated, 2);
  });

  it('refuses a batch that would archive a draft', async () => {
    const { questions } = build([makeQuestion({ id: 'q_a', status: QUESTION_STATUS.DRAFT })]);

    await assert.rejects(
      () => questions.bulkSetStatus({ ids: ['q_a'], status: QUESTION_STATUS.ARCHIVED }),
      refused,
    );
  });

  it('still lets a draft be published, retired and put back', async () => {
    const { questions } = build();
    const created = await questions.create(asDraft(), ADMIN);

    const live = await questions.setStatus(created.id, { status: QUESTION_STATUS.ACTIVE });
    assert.equal(live.status, QUESTION_STATUS.ACTIVE);

    const retired = await questions.setStatus(created.id, { status: QUESTION_STATUS.ARCHIVED });
    assert.equal(retired.status, QUESTION_STATUS.ARCHIVED);

    const back = await questions.setStatus(created.id, { status: QUESTION_STATUS.ACTIVE });
    assert.equal(back.status, QUESTION_STATUS.ACTIVE);
  });
});

describe('QuestionsService.remove — the one hard delete', () => {
  const refused = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

  it('deletes a draft nobody has used, and its versions with it', async () => {
    const { questions, prisma, audit } = build();
    const created = await questions.create(asDraft(), ADMIN);
    assert.equal(prisma.versions.length, 1);

    const { changed } = await recording(audit, () => questions.remove(created.id));

    assert.equal(prisma.questions.length, 0);
    assert.equal(prisma.versions.length, 0);
    assert.deepEqual(changed?.status, { from: QUESTION_STATUS.DRAFT, to: 'DELETED' });
  });

  /** Everything published is archived instead: a paper that pinned a version must keep reading it. */
  for (const status of [QUESTION_STATUS.ACTIVE, QUESTION_STATUS.ARCHIVED] as const) {
    it(`refuses to delete a question that is ${status}`, async () => {
      const { questions, prisma } = build();
      const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
      if (status === QUESTION_STATUS.ARCHIVED) await questions.archive(created.id);

      await assert.rejects(() => questions.remove(created.id), refused);
      assert.equal(prisma.questions.length, 1);
    });
  }

  /** Deleting what a paper keys on would leave a scored result reading a question that is gone. */
  for (const holder of ['paperRefs', 'attemptRefs', 'statRefs'] as const) {
    it(`refuses a draft that ${holder.replace('Refs', '')} already keys on`, async () => {
      const { questions, prisma } = build();
      const created = await questions.create(asDraft(), ADMIN);
      const questionVersionId = prisma.questions[0]?.currentVersionId ?? '';
      prisma[holder].push({ questionId: created.id, questionVersionId });

      await assert.rejects(() => questions.remove(created.id), refused);
      assert.equal(prisma.questions.length, 1);
      assert.equal(prisma.versions.length, 1);
    });
  }

  it('answers NOT_FOUND for a question that is not there', async () => {
    const { questions } = build();

    await assert.rejects(
      () => questions.remove('nope'),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  /** Every other path refuses ARCHIVED as a destination; creating straight into it is the last door. */
  it('refuses to create a question that is already archived', async () => {
    const { questions } = build();

    await assert.rejects(
      () => questions.create(draft({ status: QUESTION_STATUS.ARCHIVED }), ADMIN),
      refused,
    );
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

describe('bulkSetStatus', () => {
  // Fresh each time: updateMany mutates the rows, so a shared array leaks between tests.
  const drafts = () =>
    ['q1', 'q2', 'q3'].map((id) => makeQuestion({ id, status: QUESTION_STATUS.DRAFT }));

  it('moves every named question in one statement', async () => {
    const { questions, prisma } = build(drafts());

    const result = await questions.bulkSetStatus({
      ids: ['q1', 'q2'],
      status: QUESTION_STATUS.ACTIVE,
    });

    assert.equal(result.updated, 2);
    assert.equal(prisma.questions.find((q) => q.id === 'q1')?.status, QUESTION_STATUS.ACTIVE);
    assert.equal(prisma.questions.find((q) => q.id === 'q3')?.status, QUESTION_STATUS.DRAFT);
  });

  /** The same row twice must not be counted twice, or the screen reports work it did not do. */
  it('counts a repeated id once', async () => {
    const { questions } = build(drafts());

    const result = await questions.bulkSetStatus({
      ids: ['q1', 'q1', 'q1'],
      status: QUESTION_STATUS.ACTIVE,
    });

    assert.equal(result.updated, 1);
  });

  it('reports what it actually changed, not what it was asked to', async () => {
    const { questions } = build(drafts());

    const result = await questions.bulkSetStatus({
      ids: ['q1', 'gone'],
      status: QUESTION_STATUS.ACTIVE,
    });

    assert.equal(result.updated, 1);
  });
});
