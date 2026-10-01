import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { ADMIN_ROLES, ASSIGNMENT_ROLES, AppException, ErrorCodes } from '@iace/contracts';
import { SectionThreadService, type ThreadReader } from '../src/assignments/section-thread.service';
import { FakeStorage } from '../test/support/fakes';
import {
  makeCatalog,
  makeQuestionBank,
  makeSection,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const TYPIST = randomUUID();
const READER = randomUUID();
const STRANGER = randomUUID();
const BOSS = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

/** A reader by who they are and what they hold; nobody manages tests unless a case says so. */
const reader = (id: string, over: Partial<ThreadReader> = {}): ThreadReader => ({
  id,
  managesTests: false,
  ...over,
});

/** One staffed section: a typist, a proof-reader, and two people with no part in it. */
async function aSection() {
  await makeQuestionBank(prisma, {
    [TYPIST]: 'The Typist',
    [READER]: 'The Reader',
    [STRANGER]: 'Nobody In Particular',
    [BOSS]: 'The Boss',
  });
  await prisma.admin.update({ where: { id: READER }, data: { role: ADMIN_ROLES.PROOFREADER } });

  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog);
  const section = await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
  await prisma.questionAssignment.createMany({
    data: [
      {
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: TYPIST,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
      {
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: READER,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      },
    ],
  });

  return {
    thread: new SectionThreadService(prisma, new FakeStorage() as never),
    testId: test.id,
    sectionId: section.id,
  };
}

describe('SectionThreadService', () => {
  it('takes a comment from either assignee and reads the thread back in the order it was said', async () => {
    const { thread, testId, sectionId } = await aSection();

    await thread.comment(
      testId,
      sectionId,
      { body: 'Question 7 reads oddly.', images: [] },
      READER,
    );
    await thread.comment(
      testId,
      sectionId,
      { body: 'Retyped it, have a look.', images: [] },
      TYPIST,
    );

    const rows = await thread.forSection(testId, sectionId, reader(TYPIST));

    assert.deepEqual(
      rows.map((row) => [row.authorName, row.authorRole, row.body]),
      [
        ['The Reader', ADMIN_ROLES.PROOFREADER, 'Question 7 reads oddly.'],
        ['The Typist', ADMIN_ROLES.ADMIN, 'Retyped it, have a look.'],
      ],
    );
  });

  /** The whole write rule: holding a feature key is not the same as working on this section. */
  /** The failure this prevents: an edit that quietly rewrites what somebody was answering. */
  it('keeps the earlier wording when its author rewords a comment', async () => {
    const { thread, testId, sectionId } = await aSection();
    const said = await thread.comment(
      testId,
      sectionId,
      { body: 'Q7 is wrong', images: [] },
      READER,
    );

    const reworded = await thread.editComment(
      testId,
      sectionId,
      said.id,
      { body: 'Q7 option C is wrong' },
      READER,
    );

    assert.equal(reworded.body, 'Q7 option C is wrong');
    assert.deepEqual(
      reworded.revisions.map((revision) => revision.body),
      ['Q7 is wrong'],
    );
    assert.notEqual(reworded.editedAt, null);
  });

  it('refuses to reword somebody else’s comment, super admin or not', async () => {
    const { thread, testId, sectionId } = await aSection();
    const said = await thread.comment(
      testId,
      sectionId,
      { body: 'Q7 is wrong', images: [] },
      READER,
    );

    await assert.rejects(
      () => thread.editComment(testId, sectionId, said.id, { body: 'No it is not' }, TYPIST),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
  });

  /** The failure this prevents: the seat the section passed on from rewriting what it said on the way out. */
  it('refuses a reword by an author the section has passed on from', async () => {
    const { thread, testId, sectionId } = await aSection();
    const said = await thread.comment(
      testId,
      sectionId,
      { body: 'Q7 is wrong', images: [] },
      READER,
    );
    await prisma.questionAssignment.updateMany({
      where: { testId, baseConfigSectionId: sectionId, assigneeId: READER },
      data: { replacedAt: new Date() },
    });

    await assert.rejects(
      () => thread.editComment(testId, sectionId, said.id, { body: 'Q7 is fine' }, READER),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
  });

  it('refuses an admin who holds neither role on the section', async () => {
    const { thread, testId, sectionId } = await aSection();

    await assert.rejects(
      () => thread.comment(testId, sectionId, { body: 'Passing through.', images: [] }, STRANGER),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    assert.deepEqual(await thread.forSection(testId, sectionId, reader(READER)), []);
  });

  it('takes a comment from a super admin who holds no assignment at all', async () => {
    const { thread, testId, sectionId } = await aSection();

    const said = await thread.comment(
      testId,
      sectionId,
      { body: 'Ship it.', images: [] },
      BOSS,
      true,
    );

    assert.equal(said.authorName, 'The Boss');
    assert.deepEqual(
      (await thread.forSection(testId, sectionId, reader(BOSS, { managesTests: true }))).map(
        (row) => row.body,
      ),
      ['Ship it.'],
    );
  });

  /** The one path with no assignment row to prove the pair is real, so it is checked instead. */
  it('refuses a super admin a section that is not on the test', async () => {
    const { thread, testId } = await aSection();

    await assert.rejects(
      () => thread.comment(testId, uid(), { body: 'Into the void.', images: [] }, BOSS, true),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('SectionThreadService — who reads a thread', () => {
  async function discussed() {
    const staffed = await aSection();
    await staffed.thread.comment(
      staffed.testId,
      staffed.sectionId,
      { body: 'Question 7 reads oddly.', images: [] },
      READER,
    );
    return staffed;
  }

  it('reads it to either assignee and to whoever manages tests', async () => {
    const { thread, testId, sectionId } = await discussed();

    for (const allowed of [
      reader(TYPIST),
      reader(READER),
      reader(STRANGER, { managesTests: true }),
    ]) {
      const rows = await thread.forSection(testId, sectionId, allowed);
      assert.deepEqual(
        rows.map((row) => row.body),
        ['Question 7 reads oddly.'],
      );
    }
  });

  /** The failure this prevents: a typist reading the discussion on a section somebody else holds. */
  it('reads as not there to an admin holding no seat on the section', async () => {
    const { thread, testId, sectionId } = await discussed();

    await assert.rejects(
      () => thread.forSection(testId, sectionId, reader(STRANGER)),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('does not lend one section’s seat to another section of the same test', async () => {
    const { thread, testId } = await discussed();
    const catalog = await prisma.test.findUniqueOrThrow({
      where: { id: testId },
      select: { baseConfigId: true },
    });
    const other = await prisma.baseConfigSection.create({
      data: {
        id: uid(),
        baseConfigId: catalog.baseConfigId,
        name: 'Quant',
        order: 2,
        questionCount: 10,
        marksPerQuestion: 2,
        negativeMarks: 0.5,
      },
      select: { id: true },
    });

    await assert.rejects(
      () => thread.forSection(testId, other.id, reader(TYPIST)),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});
