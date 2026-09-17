import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  SAVED_QUESTION_KIND,
  type AttemptStatus,
  type SavedQuestionKind,
} from '@iace/contracts';
import { SavedQuestionsService } from '../src/saved/saved-questions.service';
import {
  makePaper,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  sitPaper,
  testPrisma,
} from './support/database';

const prisma = testPrisma();
const saved = new SavedQuestionsService(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const codeOf = (error: unknown) => (AppException.is(error) ? error.code : null);

/** A marked sitting on "Mock 1" that served two Reasoning questions, and a second student. */
async function world(status: AttemptStatus = ATTEMPT_STATUS.EVALUATED) {
  const paper = await makePaper(prisma, {
    title: 'Mock 1',
    questions: [
      { subject: 'Reasoning', stem: 'Stem for q_1' },
      { subject: 'Reasoning', stem: 'Stem for q_2' },
    ],
  });
  const student = await makeStudent(prisma);
  const other = await makeStudent(prisma);
  const sitting = await sitPaper(prisma, {
    paper,
    studentId: student.id,
    chosen: [null, null],
    timeSpent: [0, 0],
    status,
    score: 0,
  });
  const [one, two] = paper.items;
  const first = { id: one?.questionId ?? '', versionId: one?.versionId ?? '' };
  const second = { id: two?.questionId ?? '', versionId: two?.versionId ?? '' };
  return {
    catalog: paper.catalog,
    test: { id: paper.testId },
    section: { id: paper.sectionIds[0] ?? '' },
    subject: { id: one?.subjectId ?? '' },
    first,
    second,
    student,
    other,
    sitting,
  };
}

function star(
  studentId: string,
  questionId: string,
  attemptId: string | null,
  kind: SavedQuestionKind = SAVED_QUESTION_KIND.BOOKMARK,
) {
  return prisma.savedQuestion.create({
    data: { studentId, questionId, kind, attemptId },
    select: { id: true },
  });
}

describe('SavedQuestionsService — starring a question', () => {
  it('saves a question the student sat, with the sitting it came from', async () => {
    const { student, sitting, first } = await world();

    const row = await saved.bookmark(student.id, { attemptId: sitting.id, questionId: first.id });

    assert.equal(row.kind, SAVED_QUESTION_KIND.BOOKMARK);
    assert.equal(row.attemptId, sitting.id);
    assert.equal(row.subject, 'Reasoning');
    assert.equal(row.stemPreview, 'Stem for q_1');
    assert.equal(await prisma.savedQuestion.count(), 1);
  });

  it('refuses a sitting that has not been marked yet', async () => {
    const { student, sitting, first } = await world(ATTEMPT_STATUS.SUBMITTED);

    const error = await saved
      .bookmark(student.id, { attemptId: sitting.id, questionId: first.id })
      .catch((thrown: unknown) => thrown);

    assert.equal(codeOf(error), ErrorCodes.CONFLICT);
  });

  /** Another student's sitting reads as missing, never as refused — nothing is learnt from a no. */
  it('reads another student’s sitting as missing', async () => {
    const { other, sitting, first } = await world();

    const error = await saved
      .bookmark(other.id, { attemptId: sitting.id, questionId: first.id })
      .catch((thrown: unknown) => thrown);

    assert.equal(codeOf(error), ErrorCodes.NOT_FOUND);
  });

  it('starring twice leaves one row and returns the one already held', async () => {
    const { student, sitting, first } = await world();

    await saved.bookmark(student.id, { attemptId: sitting.id, questionId: first.id });
    const again = await saved.bookmark(student.id, { attemptId: sitting.id, questionId: first.id });

    assert.equal(await prisma.savedQuestion.count(), 1);
    assert.equal(again.questionId, first.id);
  });
});

describe('SavedQuestionsService — the two lists', () => {
  it('returns only the kind asked for, and only this student’s', async () => {
    const { student, other, sitting, first, second } = await world();
    await star(student.id, first.id, sitting.id);
    await star(student.id, second.id, sitting.id, SAVED_QUESTION_KIND.MISTAKE);
    await star(other.id, second.id, sitting.id);

    const page = await saved.list(student.id, {
      kind: SAVED_QUESTION_KIND.BOOKMARK,
      page: 1,
      pageSize: 20,
    });

    assert.equal(page.total, 1);
    assert.deepEqual(
      page.items.map((row) => row.questionId),
      [first.id],
    );
  });

  it('removing somebody else’s row reads as missing', async () => {
    const { student, other, sitting, first } = await world();
    const held = await star(other.id, first.id, sitting.id);

    const error = await saved.remove(student.id, held.id).catch((thrown: unknown) => thrown);

    assert.equal(codeOf(error), ErrorCodes.NOT_FOUND);
    assert.equal(await prisma.savedQuestion.count(), 1);
  });

  /** The same question met again in another paper is the same bookmark, so the star must show. */
  it('draws a star for a question starred in an earlier sitting', async () => {
    const { catalog, student, sitting, first } = await world();
    const earlierTest = await makeTest(prisma, catalog);
    const earlier = await makeSitting(prisma, {
      testId: earlierTest.id,
      studentId: student.id,
      score: 0,
    });
    const held = await star(student.id, first.id, earlier.id);

    const stars = await saved.bookmarkedIn(student.id, sitting.id);

    assert.deepEqual(stars.bookmarks, [{ questionId: first.id, savedId: held.id }]);
  });
});

describe('SavedQuestionsService — what a revision list is filtered and read by', () => {
  it('carries the paper each row was met on, and what it cost there', async () => {
    const { student } = await world();
    const paper = await makePaper(prisma, { title: 'Mock 2', questions: ['Reasoning'] });
    const sitting = await sitPaper(prisma, {
      paper,
      studentId: student.id,
      chosen: [null],
      timeSpent: [47],
      score: 0,
    });
    await star(student.id, paper.items[0]?.questionId ?? '', sitting.id);

    const page = await saved.list(student.id, {
      kind: SAVED_QUESTION_KIND.BOOKMARK,
      page: 1,
      pageSize: 20,
    });

    assert.equal(page.items[0]?.testTitle, 'Mock 2');
    assert.equal(page.items[0]?.timeSpentSec, 47);
  });

  /** A sitting that has been erased leaves the question on the list with nothing behind it. */
  it('reads a row whose sitting is gone without inventing a paper for it', async () => {
    const { student, first } = await world();
    await star(student.id, first.id, null);

    const page = await saved.list(student.id, {
      kind: SAVED_QUESTION_KIND.BOOKMARK,
      page: 1,
      pageSize: 20,
    });

    assert.equal(page.items[0]?.testId, null);
    assert.equal(page.items[0]?.timeSpentSec, null);
  });

  it('offers only the subjects and tests their own set spans', async () => {
    const { student, other, test, sitting, first, second } = await world();
    await star(student.id, first.id, sitting.id);
    await star(other.id, second.id, sitting.id);

    const facets = await saved.facets(student.id, SAVED_QUESTION_KIND.BOOKMARK);

    assert.deepEqual(facets.tests, [{ id: test.id, name: 'Mock 1' }]);
    assert.equal(facets.subjects.length, 1);
  });
});
