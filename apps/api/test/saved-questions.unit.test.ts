import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS, AppException, ErrorCodes, SAVED_QUESTION_KIND } from '@iace/contracts';
import { SavedQuestionsService } from '../src/saved/saved-questions.service';
import {
  FakeSavedPrisma,
  makeSavedAttempt,
  type FakeSavedAttempt,
  type FakeSavedRow,
} from './support/fakes';

/** A ranked test whose entry shut long ago, so its solutions — and the star — are open. */

function build(rows: FakeSavedRow[] = [], attempts: FakeSavedAttempt[] = [makeSavedAttempt()]) {
  const prisma = new FakeSavedPrisma(rows, attempts);
  return {
    prisma,
    saved: new SavedQuestionsService(prisma.asService()),
  };
}

const bookmark = (overrides: Partial<FakeSavedRow> = {}): FakeSavedRow => ({
  id: 'svq_seed',
  studentId: 'stu_1',
  questionId: 'q_1',
  kind: SAVED_QUESTION_KIND.BOOKMARK,
  attemptId: 'att_old',
  paperQuestionId: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides,
});

const codeOf = (error: unknown) => (AppException.is(error) ? error.code : null);

describe('SavedQuestionsService — starring a question', () => {
  it('saves a question the student sat, with the sitting it came from', async () => {
    const { saved, prisma } = build();

    const row = await saved.bookmark('stu_1', { attemptId: 'att_1', questionId: 'q_1' });

    assert.equal(row.kind, SAVED_QUESTION_KIND.BOOKMARK);
    assert.equal(row.attemptId, 'att_1');
    assert.equal(row.subject, 'Reasoning');
    assert.equal(row.stemPreview, 'Stem for q_1');
    assert.equal(prisma.rows.length, 1);
  });

  it('refuses a sitting that has not been marked yet', async () => {
    const { saved } = build([], [makeSavedAttempt({ status: ATTEMPT_STATUS.SUBMITTED })]);

    const error = await saved
      .bookmark('stu_1', { attemptId: 'att_1', questionId: 'q_1' })
      .catch((thrown: unknown) => thrown);

    assert.equal(codeOf(error), ErrorCodes.CONFLICT);
  });

  /** Another student's sitting reads as missing, never as refused — nothing is learnt from a no. */
  it('reads another student’s sitting as missing', async () => {
    const { saved } = build();

    const error = await saved
      .bookmark('stu_2', { attemptId: 'att_1', questionId: 'q_1' })
      .catch((thrown: unknown) => thrown);

    assert.equal(codeOf(error), ErrorCodes.NOT_FOUND);
  });

  it('starring twice leaves one row and returns the one already held', async () => {
    const { saved, prisma } = build();

    await saved.bookmark('stu_1', { attemptId: 'att_1', questionId: 'q_1' });
    const again = await saved.bookmark('stu_1', { attemptId: 'att_1', questionId: 'q_1' });

    assert.equal(prisma.rows.length, 1);
    assert.equal(again.questionId, 'q_1');
  });
});

describe('SavedQuestionsService — the two lists', () => {
  it('returns only the kind asked for, and only this student’s', async () => {
    const { saved } = build([
      bookmark(),
      bookmark({ id: 'svq_2', questionId: 'q_2', kind: SAVED_QUESTION_KIND.MISTAKE }),
      bookmark({ id: 'svq_3', studentId: 'stu_2', questionId: 'q_3' }),
    ]);

    const page = await saved.list('stu_1', {
      kind: SAVED_QUESTION_KIND.BOOKMARK,
      page: 1,
      pageSize: 20,
    });

    assert.equal(page.total, 1);
    assert.deepEqual(
      page.items.map((row) => row.questionId),
      ['q_1'],
    );
  });

  it('removing somebody else’s row reads as missing', async () => {
    const { saved, prisma } = build([bookmark({ studentId: 'stu_2' })]);

    const error = await saved.remove('stu_1', 'svq_seed').catch((thrown: unknown) => thrown);

    assert.equal(codeOf(error), ErrorCodes.NOT_FOUND);
    assert.equal(prisma.rows.length, 1);
  });

  /** The same question met again in another paper is the same bookmark, so the star must show. */
  it('draws a star for a question starred in an earlier sitting', async () => {
    const { saved } = build([bookmark({ attemptId: 'att_old' })]);

    const stars = await saved.bookmarkedIn('stu_1', 'att_1');

    assert.deepEqual(stars.bookmarks, [{ questionId: 'q_1', savedId: 'svq_seed' }]);
  });
});

describe('SavedQuestionsService — what a revision list is filtered and read by', () => {
  it('carries the paper each row was met on, and what it cost there', async () => {
    const { saved } = build(
      [bookmark({ attemptId: 'att_1' })],
      [makeSavedAttempt({ id: 'att_1', testTitle: 'Mock 1', timeByQuestion: { q_1: 47 } })],
    );

    const page = await saved.list('stu_1', {
      kind: SAVED_QUESTION_KIND.BOOKMARK,
      page: 1,
      pageSize: 20,
    });

    assert.equal(page.items[0]?.testTitle, 'Mock 1');
    assert.equal(page.items[0]?.timeSpentSec, 47);
  });

  /** A sitting that has been erased leaves the question on the list with nothing behind it. */
  it('reads a row whose sitting is gone without inventing a paper for it', async () => {
    const { saved } = build([bookmark({ attemptId: null })], []);

    const page = await saved.list('stu_1', {
      kind: SAVED_QUESTION_KIND.BOOKMARK,
      page: 1,
      pageSize: 20,
    });

    assert.equal(page.items[0]?.testId, null);
    assert.equal(page.items[0]?.timeSpentSec, null);
  });

  it('offers only the subjects and tests their own set spans', async () => {
    const { saved } = build(
      [bookmark({ id: 'svq_1', attemptId: 'att_1' })],
      [makeSavedAttempt({ id: 'att_1', testId: 'tst_1', testTitle: 'Mock 1' })],
    );

    const facets = await saved.facets('stu_1', SAVED_QUESTION_KIND.BOOKMARK);

    assert.deepEqual(facets.tests, [{ id: 'tst_1', name: 'Mock 1' }]);
    assert.equal(facets.subjects.length, 1);
  });
});
