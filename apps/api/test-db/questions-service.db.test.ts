import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  AppException,
  ASSIGNMENT_ROLES,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_STATUS,
  QUESTION_TYPE,
  TEST_STATUS,
  WRITTEN_FOR,
  plainTextOf,
  previewTextOf,
  questionAvailabilityQuerySchema,
  questionDraftSchema,
  questionListQuerySchema,
  type LocalizedContent,
  type QuestionDraftInput,
  type QuestionListQueryInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import type { PrismaService } from '../src/prisma/prisma.service';
import { QuestionsService } from '../src/questions/questions.service';
import { TaxonomyService } from '../src/questions/taxonomy.service';
import { FakeStorage } from '../test/support/fakes';
import {
  BANK,
  fourOptions,
  makeBankQuestion,
  makeCatalog,
  makeQuestion,
  makeQuestionBank,
  makeSection,
  makeSubject,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const ADMIN = randomUUID();
const OTHER_ADMIN = randomUUID();

/** One uuid per label, shared across the file so a test can name an id by what it means. */
const idCache = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  return id;
};

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

type Seeded = Omit<Parameters<typeof makeBankQuestion>[1], 'subjectId'> & { subjectId?: string };

/** The bank's taxonomy, two admins, and the questions given — each a live Quant/Arithmetic one unless told otherwise. */
async function build(seeded: Seeded[] = [], client: PrismaService = prisma) {
  await makeQuestionBank(prisma, { [ADMIN]: 'Admin One', [OTHER_ADMIN]: 'Admin Two' });
  for (const question of seeded) {
    await makeBankQuestion(prisma, {
      subjectId: BANK.QUANT,
      topicId: BANK.ARITHMETIC,
      ...question,
      id: idFor(question.id),
    });
  }
  const audit = new AuditContext();
  return {
    audit,
    questions: new QuestionsService(client, audit, new FakeStorage() as never),
    taxonomy: new TaxonomyService(prisma, new AuditContext()),
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
    subjectId: BANK.QUANT,
    topicId: BANK.ARITHMETIC,
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

const REWORDED = { en: 'What is 20% of 150, exactly?', hi: '150 का 20% कितना है?' };

/** One fewer than `draft()` writes, so `optionsWithIds` mints a list of a different length. */
const THREE_OPTIONS = [
  { position: 1, isCorrect: false, text: { en: '25', hi: '25' } },
  { position: 2, isCorrect: true, text: { en: '30', hi: '30' } },
  { position: 3, isCorrect: false, text: { en: '35', hi: '35' } },
];

const ELSEWHERE = { subjectId: BANK.GENERAL_AWARENESS, topicId: BANK.HISTORY };

const live = (over: Partial<QuestionDraftInput> = {}) =>
  draft({ status: QUESTION_STATUS.ACTIVE, ...over });

const questionRow = (id: string) => prisma.question.findUniqueOrThrow({ where: { id } });

const versions = () => prisma.questionVersion.findMany({ orderBy: { version: 'asc' } });

const conflict = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

const missing = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND;

const HOLDERS = ['paper', 'stat'] as const;

/** Something that keys on this version of the question: a paper row, or a rollup pointing at one. */
async function heldBy(
  holder: (typeof HOLDERS)[number],
  questionId: string,
  questionVersionId: string,
) {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog);
  const section = await makeSection(prisma, catalog);
  const paperRow = (onQuestion: string, onVersion: string) =>
    prisma.paperQuestion.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        questionId: onQuestion,
        questionVersionId: onVersion,
        order: 1,
        marks: 2,
        negativeMarks: 0.5,
      },
    });
  if (holder === 'paper') {
    await paperRow(questionId, questionVersionId);
  } else {
    // A rollup row points at its paper row by id alone, so another question's row carries it.
    const other = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    const row = await paperRow(other.id, other.versionId);
    await prisma.testQuestionStat.create({
      data: { testId: test.id, paperQuestionId: row.id, questionId, computedAt: new Date() },
    });
  }
}

/** A paper row pinning this exact version, on a test the caller can then open. */
async function pinnedOn(questionId: string, questionVersionId: string) {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog);
  const section = await makeSection(prisma, catalog);
  await prisma.paperQuestion.create({
    data: {
      id: uid(),
      testId: test.id,
      baseConfigId: catalog.baseConfigId,
      baseConfigSectionId: section.id,
      questionId,
      questionVersionId,
      order: 1,
      marks: 2,
      negativeMarks: 0.5,
    },
  });
  return { testId: test.id };
}

const openedAgo = (testId: string) =>
  prisma.test.update({
    where: { id: testId },
    data: { status: TEST_STATUS.ACTIVE, opensAt: new Date(Date.now() - 60_000) },
  });

const currentVersionOf = async (id: string) => (await questionRow(id)).currentVersionId ?? '';

describe('QuestionsService.create', () => {
  it('writes the content nodes and the options as version one', async () => {
    const { questions } = await build();

    const created = await questions.create(draft(), ADMIN);

    assert.equal(created.subject.name, 'QUANTITATIVE APTITUDE');
    assert.deepEqual(created.languages, ['en', 'hi']);
    assert.equal(previewTextOf(plainTextOf(created.content.en?.stem)), 'What is 20% of 150?');
    assert.equal(created.options.length, 4);
    assert.equal(created.options[1]?.isCorrect, true);
    assert.equal(created.version, 1);
    const row = await questionRow(created.id);
    assert.equal(row.createdById, ADMIN);
    assert.ok(row.stemHash);
  });

  it('refuses a question whose topic is not under its subject, naming the field', async () => {
    const { questions } = await build();

    await assert.rejects(
      () => questions.create(draft({ topicId: BANK.HISTORY }), ADMIN),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        Boolean(error.fieldErrors?.topicId),
    );
  });

  it('refuses the same question twice — the failure the bank exists to prevent', async () => {
    const { questions } = await build();
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
    const { questions } = await build();
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
  it('retires a question without deleting it, and puts it back into circulation', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);

    const archived = await questions.archive(created.id);
    assert.equal(archived.status, QUESTION_STATUS.ARCHIVED);
    assert.equal(await prisma.question.count(), 1);

    assert.equal((await questions.unarchive(created.id)).status, QUESTION_STATUS.ACTIVE);
  });

  /** Out of circulation is out of the bank: a reader has to ask for the retired by name. */
  it('keeps a retired question out of the bank until it is asked for', async () => {
    const { questions } = await build([
      { id: 'q_live' },
      { id: 'q_dead', status: QUESTION_STATUS.ARCHIVED },
    ]);

    const bank = await questions.list(listQuery());
    const retired = await questions.list(listQuery({ status: QUESTION_STATUS.ARCHIVED }));

    assert.deepEqual(
      bank.items.map((item) => item.id),
      [idFor('q_live')],
    );
    assert.deepEqual(
      retired.items.map((item) => item.id),
      [idFor('q_dead')],
    );
  });

  it('answers NOT_FOUND for a question that is not there', async () => {
    const { questions } = await build();

    await assert.rejects(() => questions.detail(randomUUID()), missing);
  });
});

describe('QuestionsService.update', () => {
  it('replaces the options rather than adding to them', async () => {
    const { questions } = await build();
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

    assert.deepEqual(
      updated.options.map((option) => previewTextOf(plainTextOf(option.text.en))),
      ['20', '30', '45', '50'],
    );
  });

  it('does not call a question a duplicate of itself', async () => {
    const { questions } = await build();
    const created = await questions.create(draft(), ADMIN);

    const updated = await questions.update(
      created.id,
      draft({ difficulty: DIFFICULTY_LEVEL.HIGH }),
      ADMIN,
    );

    assert.equal(updated.difficulty, DIFFICULTY_LEVEL.HIGH);
  });

  /** A save that rewrites the option text leaves the correct one where it was, and the diff says so. */
  it('reports a real change but no correctOptionPositions change when only the option text moves', async () => {
    const { questions, audit } = await build();
    const created = await questions.create(draft(), ADMIN);

    const { changed } = await recording(audit, () =>
      questions.update(
        created.id,
        draft({
          difficulty: DIFFICULTY_LEVEL.HIGH,
          stem: { en: 'What is 20% of 150, rounded?' },
          options: [
            { position: 1, isCorrect: false, text: { en: '20' } },
            { position: 2, isCorrect: true, text: { en: '30' } },
            { position: 3, isCorrect: false, text: { en: '45' } },
            { position: 4, isCorrect: false, text: { en: '50' } },
          ],
        }),
        ADMIN,
      ),
    );

    assert.deepEqual(changed?.difficulty, {
      from: DIFFICULTY_LEVEL.MEDIUM,
      to: DIFFICULTY_LEVEL.HIGH,
    });
    assert.ok(changed && !('correctOptionPositions' in changed));
  });
});

describe('QuestionsService.update — what versioning is for', () => {
  /** A paper on a reached test pins a version; rewriting the row it points at would move it under a student. */
  it('inserts a new version and leaves the one a paper already pinned untouched', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const [pinned] = await versions();
    const { testId } = await pinnedOn(created.id, await currentVersionOf(created.id));
    await openedAgo(testId);

    const edited = await questions.update(
      created.id,
      draft({ stem: { en: 'What is 20% of 150, rounded?', hi: '150 का 20% कितना है?' } }),
      ADMIN,
    );

    assert.equal(edited.version, 2);
    const [stillPinned, added] = await versions();
    assert.ok(added);
    assert.deepEqual(stillPinned?.content, pinned?.content);
    assert.deepEqual(stillPinned?.options, pinned?.options);
    assert.notEqual(await currentVersionOf(created.id), pinned?.id);
  });

  /** An attempt stores the option id it was shown, so an id that churned on a save would orphan its answers. */
  it('keeps an option id across an edit when its position is unchanged', async () => {
    const { questions } = await build();
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

  /** The failure this prevents: a save that did not name a status putting an archived question back into papers. */
  it('leaves an archived question archived when the save does not name a status', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    await questions.archive(created.id);

    const edited = await questions.update(created.id, draft({ questionCode: 'QA-002' }), ADMIN);

    assert.equal(edited.status, QUESTION_STATUS.ARCHIVED);
  });
});

describe('QuestionsService.update — a working copy is rewritten, not appended', () => {
  /** A draft is a working copy: saving it ten times must not leave ten versions to read through. */
  it('rewrites the one version a draft already has', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal((await versions()).length, 1);
    assert.equal(edited.version, 1);
    assert.equal(await currentVersionOf(created.id), versionId);
    assert.equal(
      previewTextOf(plainTextOf(edited.content.en?.stem)),
      'What is 20% of 150, exactly?',
    );
  });

  /** Without a version bump to read, the trail would say a draft was saved and nothing else. */
  it('records what the draft now says, though its version number did not move', async () => {
    const { questions, audit } = await build();
    const created = await questions.create(live(), ADMIN);

    const { changed } = await recording(audit, () =>
      questions.update(created.id, live({ stem: REWORDED }), ADMIN),
    );

    assert.deepEqual(changed?.['stem.EN'], {
      from: 'What is 20% of 150?',
      to: 'What is 20% of 150, exactly?',
    });
    assert.equal(changed?.['stem.HI'], undefined);
    assert.equal(changed?.version, undefined);
  });

  /** The failure this prevents: a fixed typo logging an empty diff, so the history was blank. */
  it('logs one field for a one-option edit, not an empty diff and not the whole content', async () => {
    const { questions, audit } = await build();
    const created = await questions.create(live(), ADMIN);
    const retyped = draft().options.map((option) =>
      option.position === 3 ? { ...option, text: { ...option.text, hi: '३५' } } : option,
    );

    const { changed } = await recording(audit, () =>
      questions.update(created.id, live({ options: retyped }), ADMIN),
    );

    assert.deepEqual(Object.keys(changed ?? {}), ['option.3.HI']);
    assert.deepEqual(changed?.['option.3.HI'], { from: '35', to: '३५' });
  });

  /** Every word on the row can be the second admin's, so the row should not still credit the first. */
  it('credits the admin who rewrote the draft, not the one who opened it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);

    await questions.update(created.id, live({ stem: REWORDED }), OTHER_ADMIN);

    assert.equal((await versions())[0]?.createdById, OTHER_ADMIN);
  });

  /** An attempt stores the option id it was shown, and a revision is still an edit of that row. */
  it('keeps the option ids a revision inherits', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.deepEqual(
      edited.options.map((option) => option.id),
      created.options.map((option) => option.id),
    );
  });

  it('rewrites a published question in place while nothing has drawn it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal(edited.version, 1);
    assert.equal((await versions()).length, 1);
    assert.equal(await currentVersionOf(created.id), versionId);
  });

  /** An unreached paper is not the belt status used to be — its version still rewrites in place. */
  it('rewrites in place a version an unreached paper holds, and the paper follows it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    await heldBy('paper', created.id, versionId);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal(edited.version, 1);
    assert.equal((await versions()).length, 1);
    assert.equal(await currentVersionOf(created.id), versionId);
    const pinned = await prisma.paperQuestion.findFirstOrThrow({
      where: { questionId: created.id },
      select: { questionVersionId: true },
    });
    const pinnedVersion = await prisma.questionVersion.findUniqueOrThrow({
      where: { id: pinned.questionVersionId },
      select: { content: true },
    });
    const stem = (pinnedVersion.content as LocalizedContent).en?.stem;
    assert.equal(
      previewTextOf(plainTextOf(stem)),
      REWORDED.en,
      'the paper follows the rewrite, so it now reads the new stem',
    );
  });

  /** Publishing is no longer the freeze — a paper students can reach is. */
  it('keeps revising in place after publishing, while nothing reachable pins it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    await questions.update(created.id, live({ stem: REWORDED }), ADMIN);
    assert.equal((await versions()).length, 1);

    await questions.setStatus(created.id, { status: QUESTION_STATUS.ACTIVE });
    const published = await questions.update(
      created.id,
      live({ stem: { en: 'What is 25% of 200?', hi: 'x' } }),
      ADMIN,
    );

    assert.equal(published.version, 1);
    assert.equal((await versions()).length, 1);
  });
});

describe('QuestionsService.update — revisability follows reachability', () => {
  it('rewrites in place while the test that pins the version is still a draft', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    await pinnedOn(created.id, versionId);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal((await versions()).length, 1, 'an unopened paper must not force a new version');
    assert.equal(edited.version, 1);
    assert.equal(await currentVersionOf(created.id), versionId);
  });

  it('appends once the test that pins it has opened', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    const { testId } = await pinnedOn(created.id, versionId);
    await openedAgo(testId);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal(edited.version, 2);
    assert.equal((await versions()).length, 2);
    const pinned = await prisma.paperQuestion.findFirstOrThrow({
      where: { questionId: created.id },
      select: { questionVersionId: true },
    });
    const pinnedVersion = await prisma.questionVersion.findUniqueOrThrow({
      where: { id: pinned.questionVersionId },
      select: { content: true },
    });
    const stem = (pinnedVersion.content as LocalizedContent).en?.stem;
    assert.equal(
      previewTextOf(plainTextOf(stem)),
      'What is 20% of 150?',
      'the frozen paper still reads what the student was already shown',
    );
  });

  it('appends when only a program unlock has opened, not the test itself', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const { testId } = await pinnedOn(created.id, await currentVersionOf(created.id));
    const program = await prisma.program.create({
      data: { id: uid(), code: uid(), name: 'Morning batch' },
      select: { code: true },
    });
    await prisma.test.update({
      where: { id: testId },
      data: { status: TEST_STATUS.ACTIVE, opensAt: new Date(Date.now() + 86_400_000) },
    });
    await prisma.testProgramUnlock.create({
      data: { testId, programCode: program.code, opensAt: new Date(Date.now() - 60_000) },
    });

    await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal((await versions()).length, 2, 'a program opens earlier than its test');
  });

  it('leaves a test that has not been offered unreachable, whatever its opensAt', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const { testId } = await pinnedOn(created.id, await currentVersionOf(created.id));
    await prisma.test.update({
      where: { id: testId },
      data: { opensAt: new Date(Date.now() - 60_000) },
    });

    await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal((await versions()).length, 1, 'a DRAFT test reaches nobody, past opensAt or not');
  });

  /** The design's central case: offered, so no longer DRAFT, but its own clock has not struck yet. */
  it('rewrites in place while an offered test has not opened yet', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    const { testId } = await pinnedOn(created.id, versionId);
    await prisma.test.update({
      where: { id: testId },
      data: { status: TEST_STATUS.ACTIVE, opensAt: new Date(Date.now() + 86_400_000) },
    });

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal((await versions()).length, 1, 'offered but not yet open must not force a version');
    assert.equal(edited.version, 1);
    assert.equal(await currentVersionOf(created.id), versionId);
  });

  /** `testIsOpen` treats a null opening as open now, everywhere else in this codebase — so here too. */
  it('appends once an offered test with no opening set at all is reachable now', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    const { testId } = await pinnedOn(created.id, versionId);
    await prisma.test.update({ where: { id: testId }, data: { status: TEST_STATUS.ACTIVE } });

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal(edited.version, 2, 'a null opensAt opens the test now, not never');
    assert.equal((await versions()).length, 2);
  });

  it('rewrites in place a version two unreached papers both pin, reaching them together', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    await pinnedOn(created.id, versionId);
    await pinnedOn(created.id, versionId);

    const edited = await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.equal(edited.version, 1);
    assert.equal(
      (await versions()).length,
      1,
      'a fix for one unreached paper reaches the other too',
    );
    const rows = await prisma.paperQuestion.findMany({
      where: { questionId: created.id },
      select: { questionVersionId: true },
    });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.questionVersionId, versionId);
    }
  });

  /** The failure this prevents: a sheet's stored position decoding against an array of the old length. */
  it('shortens the pinning paper’s optionIds when an in-place rewrite drops an option', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);
    await pinnedOn(created.id, versionId);

    await questions.update(created.id, live({ options: THREE_OPTIONS }), ADMIN);

    const rewritten = await prisma.questionVersion.findUniqueOrThrow({ where: { id: versionId } });
    const optionIds = (rewritten.options as unknown as { id: string }[]).map((option) => option.id);
    const row = await prisma.paperQuestion.findFirstOrThrow({ where: { questionId: created.id } });

    assert.equal(optionIds.length, 3);
    assert.deepEqual(
      row.optionIds,
      optionIds,
      'the paper follows the rewritten option ids in order',
    );
  });
});

describe('QuestionsService.versions — the chain, and who sat which wording', () => {
  it('reads newest first, naming the hand behind each link and the papers pinning it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const { testId } = await pinnedOn(created.id, await currentVersionOf(created.id));
    await openedAgo(testId);
    await questions.update(created.id, live({ stem: REWORDED }), OTHER_ADMIN);
    const sat = await prisma.test.findUniqueOrThrow({
      where: { id: testId },
      select: { title: true },
    });

    const chain = await questions.versions(created.id);

    assert.deepEqual(
      chain.map((link) => link.version),
      [2, 1],
    );
    assert.deepEqual(
      chain.map((link) => link.authorName),
      ['Admin Two', 'Admin One'],
    );
    assert.deepEqual(
      chain.map((link) => link.pinnedBy),
      [[], [sat.title]],
      'the opened paper still points at version one, and nothing points at two',
    );
  });

  it('refuses a question that does not exist', async () => {
    const { questions } = await build();

    await assert.rejects(() => questions.versions(uid()), missing);
  });
});

describe('QuestionsService — being depended on is what settles taxonomy', () => {
  /** The failure this prevents: a Quant question served inside the Reasoning section that drew it. */
  it('refuses to move a question a paper has drawn to another subject', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    await heldBy('paper', created.id, await currentVersionOf(created.id));

    await assert.rejects(() => questions.update(created.id, live(ELSEWHERE), ADMIN), conflict);
    assert.equal((await questionRow(created.id)).subjectId, BANK.QUANT);
  });

  it('lets a question nothing has drawn be moved to another subject', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);

    const moved = await questions.update(created.id, live(ELSEWHERE), ADMIN);

    assert.equal(moved.subject.id, BANK.GENERAL_AWARENESS);
  });
});

describe('QuestionsService — finding a question again', () => {
  /** The bug: both intake paths escape, so a search for the ampersand the admin typed missed it. */
  it('searches for the characters as content stores them', async () => {
    const { questions } = await build();
    // What the editor and the importer both write for "Ram & Shyam".
    await questions.create(
      live({ stem: { en: '<p>Is Ram &amp; Shyam a pair?</p>', hi: '<p>राम और श्याम?</p>' } }),
      ADMIN,
    );

    const found = await questions.list(listQuery({ q: 'Ram & Shyam' }));

    assert.equal(found.items.length, 1);
  });

  /** An archived twin is not in the list the admin is sent back to, so the error has to say so. */
  it('says where the duplicate is when it is out of circulation', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
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
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);

    assert.equal(created.inUse, false);
    assert.equal((await questions.list(listQuery())).items[0]?.inUse, false);
  });

  /** The screen offers Delete and Return to draft off this, so it must agree with the rules. */
  it('says a question a paper has drawn cannot', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    await heldBy('paper', created.id, await currentVersionOf(created.id));

    assert.equal((await questions.list(listQuery())).items[0]?.inUse, true);
    assert.equal((await questions.detail(created.id)).inUse, true);
  });

  /** The failure this prevents: a form open since before somebody else's save overwriting it. */
  it('refuses a save built on a screen somebody has since changed, and takes one that is current', async () => {
    const { questions } = await build();
    const stale = await questions.create(live(), ADMIN);
    await questions.update(stale.id, live({ stem: REWORDED }), ADMIN);
    const current = await questions.detail(stale.id);

    await assert.rejects(
      () =>
        questions.update(
          stale.id,
          live({ expectedUpdatedAt: stale.updatedAt, questionCode: 'QA-9' }),
          ADMIN,
        ),
      conflict,
    );
    const saved = await questions.update(
      stale.id,
      live({ stem: REWORDED, expectedUpdatedAt: current.updatedAt, questionCode: 'QA-9' }),
      ADMIN,
    );

    assert.equal(saved.questionCode, 'QA-9');
  });

  it('carries the English stem and the languages into the row', async () => {
    const { questions } = await build();
    await questions.create(draft(), ADMIN);

    const [row] = (await questions.list(listQuery())).items;

    assert.equal(row?.stemPreview, 'What is 20% of 150?');
    assert.deepEqual(row?.languages, ['en', 'hi']);
    assert.equal(row?.type, QUESTION_TYPE.SINGLE_MCQ);
  });

  it('filters by subject and pages', async () => {
    const { questions } = await build([
      { id: 'q1' },
      { id: 'q2', subjectId: BANK.GENERAL_AWARENESS, topicId: BANK.HISTORY },
      { id: 'q3' },
    ]);

    const page = await questions.list(listQuery({ pageSize: 2, subjectId: BANK.QUANT }));

    assert.equal(page.total, 2);
    assert.equal(page.items.length, 2);
    assert.equal(page.pageSize, 2);
    assert.ok(page.items.every((item) => item.subject.id === BANK.QUANT));
  });
});

describe('QuestionsService.remove — the one hard delete', () => {
  it('deletes a question nobody has used, and its versions with it', async () => {
    const { questions, audit } = await build();
    const created = await questions.create(live(), ADMIN);

    const { changed } = await recording(audit, () => questions.remove(created.id));

    assert.equal(await prisma.question.count(), 0);
    assert.equal(await prisma.questionVersion.count(), 0);
    assert.deepEqual(changed?.status, { from: QUESTION_STATUS.ACTIVE, to: 'DELETED' });
  });

  /** Status is not what makes a question safe to remove — having nothing depend on it is. */
  for (const status of [QUESTION_STATUS.ACTIVE, QUESTION_STATUS.ARCHIVED] as const) {
    it(`deletes an unreferenced question that is ${status}`, async () => {
      const { questions } = await build();
      const created = await questions.create(live(), ADMIN);
      if (status === QUESTION_STATUS.ARCHIVED) await questions.archive(created.id);

      await questions.remove(created.id);

      assert.equal(await prisma.question.count(), 0);
      assert.equal(await prisma.questionVersion.count(), 0);
    });
  }

  /** Deleting what a paper keys on would leave a scored result reading a question that is gone. */
  for (const holder of HOLDERS) {
    it(`refuses a draft that a ${holder} already keys on`, async () => {
      const { questions } = await build();
      const created = await questions.create(live(), ADMIN);
      await heldBy(holder, created.id, await currentVersionOf(created.id));

      await assert.rejects(() => questions.remove(created.id), conflict);
      assert.ok(await prisma.question.findUnique({ where: { id: created.id } }));
      assert.equal(await prisma.questionVersion.count({ where: { questionId: created.id } }), 1);
    });
  }

  it('answers NOT_FOUND for a question that is not there', async () => {
    const { questions } = await build();

    await assert.rejects(() => questions.remove(randomUUID()), missing);
  });

  /** Every other path refuses ARCHIVED as a destination; creating straight into it is the last door. */
  it('refuses to create a question that is already archived', async () => {
    const { questions } = await build();

    await assert.rejects(
      () => questions.create(draft({ status: QUESTION_STATUS.ARCHIVED }), ADMIN),
      conflict,
    );
  });
});

describe('QuestionsService.update — a save that changes nothing', () => {
  /** The failure: one admin's save reverting another's approval, and rewriting the version under it. */
  it('refuses a save whose question moved between the read and the write', async () => {
    const racing = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== '$transaction') return Reflect.get(target, key) as unknown;
        return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction(async (tx) => {
            const read = tx.question.findUnique.bind(tx.question);
            return work(
              new Proxy(tx, {
                get(inner, model: string | symbol) {
                  if (model !== 'question') return Reflect.get(inner, model) as unknown;
                  return new Proxy(inner.question, {
                    get(delegate, method: string | symbol) {
                      if (method !== 'findUnique') return Reflect.get(delegate, method) as unknown;
                      // Another admin's save lands after this transaction read the row.
                      return async (args: Prisma.QuestionFindUniqueArgs) => {
                        const row = await read(args);
                        await prisma.question.update({
                          where: { id: args.where.id ?? '' },
                          data: { updatedAt: new Date(Date.now() + 1000) },
                        });
                        return row;
                      };
                    },
                  });
                },
              }),
            );
          });
      },
    });
    const { questions } = await build([], racing);
    const created = await questions.create(live(), ADMIN);

    await assert.rejects(
      () => questions.update(created.id, live({ stem: REWORDED }), ADMIN),
      conflict,
    );
    const stored = await versions();
    assert.equal(stored.length, 1);
    const content = stored[0]?.content as LocalizedContent;
    assert.equal(previewTextOf(plainTextOf(content.en?.stem)), 'What is 20% of 150?');
  });

  it('writes no version when the content is byte for byte what is stored', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const versionId = await currentVersionOf(created.id);

    const saved = await questions.update(created.id, live(), ADMIN);

    assert.equal((await versions()).length, 1);
    assert.equal(saved.version, 1);
    assert.equal(await currentVersionOf(created.id), versionId);
  });

  /** Re-crediting a draft on every save would hand it to whoever opened it last. */
  it('leaves a draft credited to whoever actually wrote it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);
    const [written] = await versions();

    await questions.update(created.id, live(), OTHER_ADMIN);

    const [after] = await versions();
    assert.equal(after?.createdById, ADMIN);
    assert.deepEqual(after?.createdAt, written?.createdAt);
  });

  /** Tags live on the question, not the version, so retagging is not a new version of anything. */
  it('changes what the question row holds without versioning it', async () => {
    const { questions } = await build();
    const created = await questions.create(live(), ADMIN);

    const saved = await questions.update(
      created.id,
      live({ tags: ['ssc cgl'], difficulty: DIFFICULTY_LEVEL.HIGH }),
      ADMIN,
    );

    assert.equal((await versions()).length, 1);
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
      const { questions } = await build();
      const created = await questions.create(live(), ADMIN);
      const { testId } = await pinnedOn(created.id, await currentVersionOf(created.id));
      await openedAgo(testId);

      const saved = await questions.update(created.id, live(over), ADMIN);

      assert.equal((await versions()).length, 2);
      assert.equal(saved.version, 2);
    });
  }
});

describe('TaxonomyService', () => {
  it('refuses a second subject with the same name', async () => {
    const { taxonomy } = await build();

    await assert.rejects(
      () => taxonomy.createSubject({ name: 'QUANTITATIVE APTITUDE' }),
      (error: unknown) =>
        conflict(error) && AppException.is(error) && Boolean(error.fieldErrors?.name),
    );
  });
});

describe('QuestionsService — serving legacy images', () => {
  /** Fails if signedAll's `keys.size === 0` shortcut returns: a key-less legacy image would survive. */
  it('strips an external src a key-less legacy image quotes, on a detail read', async () => {
    const { questions } = await build();
    const subject = (await makeSubject(prisma)).id;
    const created = await makeQuestion(prisma, {
      subjectId: subject,
      content: {
        en: {
          stem: [{ type: 'TEXT', text: '<p>Look<img src="https://tracker.example/x.gif"></p>' }],
        },
      },
      options: fourOptions(),
    });

    const stem = (await questions.detail(created.id)).content.en?.stem?.[0]?.text ?? '';

    assert.doesNotMatch(stem, /tracker\.example/);
    assert.doesNotMatch(stem, /<img/);
  });
});

describe('QuestionsService.availability — the count a section is about to draw from', () => {
  /** The failure this prevents: the builder promises three and fillSection then refuses with two. */
  it('counts exactly what a paper may draw, leaving out the archived and the unversioned', async () => {
    const { questions } = await build([
      { id: 'live', status: QUESTION_STATUS.ACTIVE },
      { id: 'also_live', status: QUESTION_STATUS.ACTIVE },
      { id: 'archived', status: QUESTION_STATUS.ARCHIVED },
      { id: 'unversioned', status: QUESTION_STATUS.ACTIVE, versioned: false },
    ]);

    const held = await questions.availability(
      questionAvailabilityQuerySchema.parse({ subjectId: BANK.QUANT }),
    );

    assert.equal(held.total, 2, 'the archived and the unversioned do not count');
  });
});

describe('QuestionsService.page — the picker asks for what the draw would find', () => {
  /** The failure this prevents: the picker offers a row, and fillSection then refuses it. */
  it('leaves the archived and the unversioned out of what a paper may draw', async () => {
    const { questions } = await build([
      { id: 'live', status: QUESTION_STATUS.ACTIVE },
      { id: 'also_live', status: QUESTION_STATUS.ACTIVE },
      { id: 'archived', status: QUESTION_STATUS.ARCHIVED },
      { id: 'unversioned', status: QUESTION_STATUS.ACTIVE, versioned: false },
    ]);

    const page = await questions.page(listQuery({ drawable: 'true' }));

    assert.deepEqual(
      page.items.map((row) => row.id).sort(),
      [idFor('also_live'), idFor('live')].sort(),
    );
  });
});

/** One section of one test handed to a typist, with the question they wrote against it. */
async function assignedFor(questionId: string): Promise<string> {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog);
  const section = await makeSection(prisma, catalog);
  const assignment = await prisma.questionAssignment.create({
    data: {
      id: uid(),
      testId: test.id,
      baseConfigId: catalog.baseConfigId,
      baseConfigSectionId: section.id,
      assigneeId: ADMIN,
      role: ASSIGNMENT_ROLES.TYPIST,
    },
    select: { id: true },
  });
  await prisma.question.update({
    where: { id: questionId },
    data: { assignmentId: assignment.id },
  });
  return test.id;
}

describe('QuestionsService.page — a test’s own authoring, and the rest of the bank', () => {
  /** The failure this prevents: hunting the twenty written for this test among thousands. */
  it('answers either side of the split from the assignment relation alone', async () => {
    const { questions } = await build([{ id: 'ours' }, { id: 'theirs' }, { id: 'banked' }]);
    const testId = await assignedFor(idFor('ours'));
    await assignedFor(idFor('theirs'));

    const written = await questions.page(
      listQuery({ writtenForTestId: testId, writtenFor: WRITTEN_FOR.TEST }),
    );
    const banked = await questions.page(
      listQuery({ writtenForTestId: testId, writtenFor: WRITTEN_FOR.BANK }),
    );

    assert.deepEqual(
      written.items.map((row) => row.id),
      [idFor('ours')],
    );
    assert.deepEqual(
      banked.items.map((row) => row.id).sort(),
      [idFor('banked'), idFor('theirs')].sort(),
      'another test’s authoring is bank to this one, and so is a question with no assignment',
    );
  });

  it('narrows nothing when no side is named', async () => {
    const { questions } = await build([{ id: 'ours' }, { id: 'banked' }]);
    const testId = await assignedFor(idFor('ours'));

    const page = await questions.page(listQuery({ writtenForTestId: testId }));

    assert.equal(page.total, 2);
  });
});

const LOCK_ORDER = { TESTS: 'the tests holding it', QUESTION: 'the question row' } as const;

/** Nothing outside the transaction can see a lock, so what it records is the order the statements left in. */
function watchingLocks(order: string[]): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction((tx) => work(recordingLocks(tx, order)));
    },
  });
}

function recordingLocks(tx: Prisma.TransactionClient, order: string[]): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(inner, member: string | symbol) {
      if (member === '$queryRaw') {
        return (sql: TemplateStringsArray, ...values: unknown[]) => {
          const statement = sql.join('?');
          if (statement.includes('FROM "Test"') && statement.includes('FOR UPDATE')) {
            order.push(LOCK_ORDER.TESTS);
          }
          return inner.$queryRaw(sql, ...values);
        };
      }
      if (member !== 'question') return Reflect.get(inner, member) as unknown;
      return new Proxy(inner.question, {
        get(delegate, method: string | symbol) {
          if (method !== 'updateMany') return Reflect.get(delegate, method) as unknown;
          return (args: Prisma.QuestionUpdateManyArgs) => {
            order.push(LOCK_ORDER.QUESTION);
            return delegate.updateMany(args);
          };
        },
      });
    },
  });
}

describe('QuestionsService.update — one lock order, Test before Question', () => {
  /** The failure this prevents: an edit and a finalize taking the same two rows in opposite orders. */
  it('locks the tests holding the question before it claims the question row', async () => {
    const order: string[] = [];
    const { questions } = await build([], watchingLocks(order));
    const created = await questions.create(live(), ADMIN);
    await heldBy('paper', created.id, await currentVersionOf(created.id));

    await questions.update(created.id, live({ stem: REWORDED }), ADMIN);

    assert.deepEqual(order, [LOCK_ORDER.TESTS, LOCK_ORDER.QUESTION]);
  });
});
