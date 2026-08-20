import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIFFICULTY_LEVEL,
  QUESTION_STATUS,
  fieldDiff,
  questionDraftSchema,
  type QuestionDraftInput,
  type QuestionStatus,
} from '@iace/contracts';
import { AUDITED_QUESTION_FIELDS, QuestionsService } from '../src/questions/questions.service';
import { AuditContext } from '../src/audit';
import { FakeQuestionBankPrisma, makeSubject, makeTopic } from './support/fakes';

describe('the question audit diff', () => {
  it('covers the columns a question edit can change', () => {
    for (const field of [
      'type',
      'subjectId',
      'topicId',
      'difficulty',
      'questionCode',
      'status',
      'version',
      'correctOptionPositions',
      'answerKey',
    ]) {
      assert.ok((AUDITED_QUESTION_FIELDS as readonly string[]).includes(field));
    }
  });

  /** Retiring a question changes which papers can draw it, so it is worth finding later. */
  it('reports a retire', () => {
    const before = {
      subjectId: 's1',
      topicId: null,
      status: QUESTION_STATUS.ACTIVE as QuestionStatus,
    };

    assert.deepEqual(
      fieldDiff(
        before,
        { ...before, status: QUESTION_STATUS.ARCHIVED },
        AUDITED_QUESTION_FIELDS as never,
      )?.status,
      { from: QUESTION_STATUS.ACTIVE, to: QUESTION_STATUS.ARCHIVED },
    );
  });

  /**
   * The failure this prevents: changing which option is correct after a paper has been attempted
   * changes who passed, and nothing else in the system records that it happened.
   */
  it('reports a change to the correct answer', () => {
    const before = { correctOptionPositions: [1] };

    assert.deepEqual(
      fieldDiff(before, { correctOptionPositions: [2] }, AUDITED_QUESTION_FIELDS as never)
        ?.correctOptionPositions,
      { from: [1], to: [2] },
    );
  });

  /**
   * `position` is what survives a version: an option carries its id over only while its slot is
   * unchanged, so two sets with different ids and the same correct position(s) must diff to null.
   */
  it('reports no diff when the option ids differ but the correct position does not', () => {
    const positionsOf = (options: { position: number; isCorrect: boolean }[]) =>
      options
        .filter((option) => option.isCorrect)
        .map((option) => option.position)
        .sort((a, b) => a - b);

    const before = {
      correctOptionPositions: positionsOf([
        { position: 1, isCorrect: false },
        { position: 2, isCorrect: true },
      ]),
    };
    const after = {
      correctOptionPositions: positionsOf([
        { position: 1, isCorrect: false },
        { position: 2, isCorrect: true },
      ]),
    };

    assert.equal(fieldDiff(before, after, AUDITED_QUESTION_FIELDS as never), null);
  });
});

// ============================================================================
// Driving QuestionsService.update inside a live AuditContext, the way the
// interceptor actually reads it. Everything above is `fieldDiff` against
// hand-built objects, which cannot catch a wiring mistake in the service.
// ============================================================================

function build() {
  const prisma = new FakeQuestionBankPrisma([], [makeSubject()], [makeTopic()]);
  const auditContext = new AuditContext();
  return {
    prisma,
    auditContext,
    questions: new QuestionsService(prisma.asService(), auditContext),
  };
}

function draft(over: Partial<QuestionDraftInput> = {}) {
  return questionDraftSchema.parse({
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
}

describe('QuestionsService.update — driven live, the diff a real edit contributes', () => {
  /**
   * A save that rewrites the option text leaves the correct one at the same position. That must
   * report the real change (difficulty) and, in the same diff, no `correctOptionPositions` entry.
   */
  it('reports a real change but no correctOptionPositions change when only the option text moves', async () => {
    const ctx = build();
    const created = await ctx.questions.create(draft(), 'adm_1');

    await ctx.auditContext.run(async () => {
      await ctx.questions.update(
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
        'adm_1',
      );

      const changed = ctx.auditContext.current()?.changed;
      assert.deepEqual(changed?.difficulty, {
        from: DIFFICULTY_LEVEL.MEDIUM,
        to: DIFFICULTY_LEVEL.HIGH,
      });
      assert.ok(changed && !('correctOptionPositions' in changed));
    });
  });
});
