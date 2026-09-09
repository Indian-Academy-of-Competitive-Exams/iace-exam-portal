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
  type LocalizedContent,
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
  makeQuestionFlag,
  makeSubject,
  makeTopic,
  rowAt,
} from './support/fakes';
import { pngBytes } from './support/image-bytes';

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

  /** Retire then restore would put an unreviewed draft in circulation; delete is its way out. */
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

    const pinned = rowAt(prisma.versions);
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

describe('QuestionsService — a question returns to draft while nothing uses it', () => {
  const refused = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

  const used = (prisma: ReturnType<typeof build>['prisma'], id: string) =>
    prisma.paperRefs.push({ questionId: id, questionVersionId: 'any' });

  it('sends a published question nothing has drawn back to draft', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    const back = await questions.setStatus(created.id, { status: QUESTION_STATUS.DRAFT });

    assert.equal(back.status, QUESTION_STATUS.DRAFT);
  });

  /** The failure this prevents: rewriting version 3 in place under a paper that pinned it. */
  it('refuses once a paper has drawn it', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    used(prisma, created.id);

    await assert.rejects(
      () => questions.setStatus(created.id, { status: QUESTION_STATUS.DRAFT }),
      refused,
    );
  });

  it('refuses through a save as well as a status change', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    used(prisma, created.id);

    await assert.rejects(
      () => questions.update(created.id, draft({ status: QUESTION_STATUS.DRAFT }), ADMIN),
      refused,
    );
    assert.equal(prisma.questions[0]?.status, QUESTION_STATUS.ACTIVE);
  });

  it('brings a retired question back to draft when nothing uses it', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    await questions.archive(created.id);

    const back = await questions.setStatus(created.id, { status: QUESTION_STATUS.DRAFT });

    assert.equal(back.status, QUESTION_STATUS.DRAFT);
  });

  /** A batch is one decision, so one row that cannot make the move refuses all of it. */
  it('refuses a batch holding one question something uses', async () => {
    const { questions, prisma } = build([
      makeQuestion({ id: 'q_free', status: QUESTION_STATUS.ACTIVE }),
      makeQuestion({ id: 'q_drawn', status: QUESTION_STATUS.ACTIVE, stemHash: 'hash_2' }),
    ]);
    used(prisma, 'q_drawn');

    await assert.rejects(
      () => questions.bulkSetStatus({ ids: ['q_free', 'q_drawn'], status: 'DRAFT' }),
      refused,
    );
    assert.equal(prisma.questions[0]?.status, QUESTION_STATUS.ACTIVE);
  });

  /** Taxonomy is what a paper draws on, so it settles when the question leaves the draft. */
  it('refuses to move a published question to another subject', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    await assert.rejects(
      () =>
        questions.update(
          created.id,
          draft({ status: QUESTION_STATUS.ACTIVE, subjectId: 'sub_2', topicId: 'top_3' }),
          ADMIN,
        ),
      refused,
    );
  });

  it('lets a draft be moved to another subject', async () => {
    const { questions } = build();
    const created = await questions.create(asDraft(), ADMIN);

    const moved = await questions.update(
      created.id,
      asDraft({ subjectId: 'sub_2', topicId: 'top_3' }),
      ADMIN,
    );

    assert.equal(moved.subject.id, 'sub_2');
  });
});

describe('QuestionsService — finding a question again', () => {
  /** The bug: both intake paths escape, so a search for the ampersand the admin typed missed it. */
  it('searches for the characters as content stores them', async () => {
    const { questions } = build();
    // What the editor and the importer both write for "Ram & Shyam".
    await questions.create(
      draft({
        stem: { en: '<p>Is Ram &amp; Shyam a pair?</p>', hi: '<p>राम और श्याम?</p>' },
        status: QUESTION_STATUS.ACTIVE,
      }),
      ADMIN,
    );

    const found = await questions.list(listQuery({ q: 'Ram & Shyam' }));

    assert.equal(found.items.length, 1);
  });

  /** An archived twin is not in the list the admin is sent back to, so the error has to say so. */
  it('says where the duplicate is when it is out of circulation', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    await questions.archive(created.id);

    await assert.rejects(
      () => questions.create(draft({ questionCode: 'QA-DUP' }), ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /archived/);
        assert.deepEqual(error.details, { duplicateOf: created.id });
        return true;
      },
    );
  });
});

describe('QuestionsService — what the screen is told', () => {
  it('says a question nothing points at can still be undone', async () => {
    const { questions } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    assert.equal(created.inUse, false);
    const listed = await questions.list(listQuery());
    assert.equal(listed.items[0]?.inUse, false);
  });

  /** The screen offers Delete and Return to draft off this, so it must agree with the rules. */
  it('says a question a paper has drawn cannot', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    prisma.paperRefs.push({ questionId: created.id, questionVersionId: 'any' });

    const listed = await questions.list(listQuery());

    assert.equal(listed.items[0]?.inUse, true);
    assert.equal((await questions.detail(created.id)).inUse, true);
  });

  /** The failure this prevents: a form open since before somebody else's save overwriting it. */
  it('refuses a save built on a screen somebody has since changed', async () => {
    const { questions } = build();
    const created = await questions.create(asDraft(), ADMIN);
    await questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN);

    await assert.rejects(
      () =>
        questions.update(
          created.id,
          asDraft({ expectedUpdatedAt: created.updatedAt, questionCode: 'QA-9' }),
          ADMIN,
        ),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });

  it('takes a save that names the screen it was built from', async () => {
    const { questions } = build();
    const created = await questions.create(asDraft(), ADMIN);

    const saved = await questions.update(
      created.id,
      asDraft({ expectedUpdatedAt: created.updatedAt, questionCode: 'QA-9' }),
      ADMIN,
    );

    assert.equal(saved.questionCode, 'QA-9');
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

  /** Status is not what makes a question safe to remove — having nothing depend on it is. */
  for (const status of [QUESTION_STATUS.ACTIVE, QUESTION_STATUS.ARCHIVED] as const) {
    it(`deletes an unreferenced question that is ${status}`, async () => {
      const { questions, prisma } = build();
      const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
      if (status === QUESTION_STATUS.ARCHIVED) await questions.archive(created.id);

      await questions.remove(created.id);

      assert.equal(prisma.questions.length, 0);
      assert.equal(prisma.versions.length, 0);
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

describe('QuestionsService.update — a save that changes nothing', () => {
  /** The bug: opening a question and pressing Save wrote version 2 of identical content. */
  /** The failure: one admin's save reverting another's approval, and rewriting the version under it. */
  it('refuses a save whose question moved between the read and the write', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(asDraft(), ADMIN);

    // This save reads the row, then another admin's save lands, then this one tries to write.
    const read = prisma.question.findUnique;
    let reads = 0;
    prisma.question.findUnique = (args: { where: { id: string } }) => {
      const row = read(args);
      reads += 1;
      if (reads === 2) rowAt(prisma.questions).updatedAt = new Date(Date.now() + 1000);
      return row;
    };

    await assert.rejects(
      () => questions.update(created.id, asDraft({ stem: REWORDED }), ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
    assert.equal(prisma.versions.length, 1);
    const stored = prisma.versions[0]?.content as LocalizedContent;
    assert.equal(previewTextOf(plainTextOf(stored.en?.stem)), 'What is 20% of 150?');
  });

  it('writes no version when the content is byte for byte what is stored', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    const versionId = prisma.questions[0]?.currentVersionId;

    const saved = await questions.update(
      created.id,
      draft({ status: QUESTION_STATUS.ACTIVE }),
      ADMIN,
    );

    assert.equal(prisma.versions.length, 1);
    assert.equal(saved.version, 1);
    assert.equal(prisma.questions[0]?.currentVersionId, versionId);
  });

  /** Re-crediting a draft on every save would hand it to whoever opened it last. */
  it('leaves a draft credited to whoever actually wrote it', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(asDraft(), ADMIN);
    const writtenAt = prisma.versions[0]?.createdAt;

    await questions.update(created.id, asDraft(), 'adm_2');

    assert.equal(prisma.versions[0]?.createdById, ADMIN);
    assert.equal(prisma.versions[0]?.createdAt, writtenAt);
  });

  /** Tags live on the question, not the version, so retagging is not a new version of anything. */
  it('changes what the question row holds without versioning it', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

    const saved = await questions.update(
      created.id,
      draft({
        status: QUESTION_STATUS.ACTIVE,
        tags: ['ssc cgl'],
        difficulty: DIFFICULTY_LEVEL.HIGH,
      }),
      ADMIN,
    );

    assert.equal(prisma.versions.length, 1);
    assert.deepEqual(saved.tags, ['ssc cgl']);
    assert.equal(saved.difficulty, DIFFICULTY_LEVEL.HIGH);
  });

  /** The stem hash reads none of these, which is why it is the wrong comparator for a save. */
  const ONLY: [string, Partial<QuestionDraftInput>][] = [
    ['solution', { solution: { en: 'Twenty percent of 150 is 30.' } }],
    ['translation', { stem: { en: 'What is 20% of 150?', hi: '150 का बीस प्रतिशत?' } }],
    [
      'an option in one language',
      {
        options: [
          { position: 1, isCorrect: false, text: { en: '25', hi: 'पच्चीस' } },
          { position: 2, isCorrect: true, text: { en: '30', hi: '30' } },
          { position: 3, isCorrect: false, text: { en: '35', hi: '35' } },
          { position: 4, isCorrect: false, text: { en: '40', hi: '40' } },
        ],
      },
    ],
  ];

  for (const [what, over] of ONLY) {
    it(`versions a published question when only ${what} changed`, async () => {
      const { questions, prisma } = build();
      const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);

      const saved = await questions.update(
        created.id,
        draft({ status: QUESTION_STATUS.ACTIVE, ...over }),
        ADMIN,
      );

      assert.equal(prisma.versions.length, 2);
      assert.equal(saved.version, 2);
    });
  }
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

    const buffer = pngBytes(800, 600);
    const saved = await questions.saveImage({ buffer, size: buffer.length, mimetype: 'image/png' });

    assert.ok(saved.key.startsWith('questions/images/'));
    assert.deepEqual(storage.objects.get(saved.key), buffer);
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

describe('QuestionsService — an open proof-reading flag blocks the way into circulation', () => {
  const refused = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

  const flag = (prisma: ReturnType<typeof build>['prisma'], questionId: string, over = {}) =>
    prisma.flags.push(makeQuestionFlag({ id: `qfl_${questionId}`, questionId, ...over }));

  it('refuses a single approval while a flag is open, and lets it through once settled', async () => {
    const { questions, prisma } = build([
      makeQuestion({ id: 'q1', status: QUESTION_STATUS.DRAFT }),
    ]);
    flag(prisma, 'q1');

    await assert.rejects(
      () => questions.setStatus('q1', { status: QUESTION_STATUS.ACTIVE }),
      refused,
    );
    assert.equal(prisma.questions[0]?.status, QUESTION_STATUS.DRAFT);

    prisma.flags.splice(0, 1, makeQuestionFlag({ questionId: 'q1', status: 'RESOLVED' }));
    const approved = await questions.setStatus('q1', { status: QUESTION_STATUS.ACTIVE });

    assert.equal(approved.status, QUESTION_STATUS.ACTIVE);
  });

  /** The bulk screen is the other way in, so the same gate has to hold there. */
  it('refuses a batch holding one flagged question, and leaves every row where it was', async () => {
    const { questions, prisma } = build([
      makeQuestion({ id: 'q_clean', status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'q_flagged', status: QUESTION_STATUS.DRAFT, stemHash: 'hash_2' }),
    ]);
    flag(prisma, 'q_flagged');

    await assert.rejects(
      () =>
        questions.bulkSetStatus({ ids: ['q_clean', 'q_flagged'], status: QUESTION_STATUS.ACTIVE }),
      refused,
    );
    assert.deepEqual(
      prisma.questions.map((row) => row.status),
      [QUESTION_STATUS.DRAFT, QUESTION_STATUS.DRAFT],
    );
  });

  it('lets a batch through once every flag on it has been settled', async () => {
    const { questions, prisma } = build([
      makeQuestion({ id: 'q1', status: QUESTION_STATUS.DRAFT }),
      makeQuestion({ id: 'q2', status: QUESTION_STATUS.DRAFT, stemHash: 'hash_2' }),
    ]);
    flag(prisma, 'q1', { status: 'DISMISSED' });

    const result = await questions.bulkSetStatus({
      ids: ['q1', 'q2'],
      status: QUESTION_STATUS.ACTIVE,
    });

    assert.equal(result.updated, 2);
  });

  /** Authors fix, reviewers settle: a flag must not lock the question it was raised against. */
  it('still lets an author save a question that is already active and flagged', async () => {
    const { questions, prisma } = build();
    const created = await questions.create(draft({ status: QUESTION_STATUS.ACTIVE }), ADMIN);
    flag(prisma, created.id);

    const edited = await questions.update(
      created.id,
      draft({ status: QUESTION_STATUS.ACTIVE, stem: { en: 'What is 25% of 200?', hi: 'x' } }),
      ADMIN,
    );

    assert.equal(edited.status, QUESTION_STATUS.ACTIVE);
    assert.equal(edited.openFlags, 1);
  });

  /** The count is what the approvals screen shows, so the block is never a surprise. */
  it('counts only the open flags on a listed question', async () => {
    const { questions, prisma } = build([makeQuestion({ id: 'q1' })]);
    flag(prisma, 'q1');
    prisma.flags.push(makeQuestionFlag({ id: 'qfl_2', questionId: 'q1', status: 'RESOLVED' }));

    const page = await questions.list(listQuery());

    assert.equal(page.items[0]?.openFlags, 1);
  });
});
