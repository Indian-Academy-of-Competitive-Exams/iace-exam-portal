import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTION,
  DIFFICULTY_LEVEL,
  fieldDiff,
  questionDraftSchema,
  type QuestionDraftInput,
} from '@iace/contracts';
import { TOGGLE_ACTIONS } from '../src/audit/audit.decorator';
import { AUDITED_QUESTION_FIELDS, QuestionsService } from '../src/questions/questions.service';
import { AuditContext } from '../src/audit';
import { FakeQuestionBankPrisma, makeSubTopic, makeSubject, makeTopic } from './support/fakes';

describe('the question audit diff', () => {
  it('covers the columns a question edit can change', () => {
    for (const field of [
      'type',
      'subjectId',
      'topicId',
      'subTopicId',
      'difficulty',
      'questionCode',
      'status',
      'isActive',
      'defaultMarks',
      'defaultNegativeMarks',
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
      subTopicId: null,
      isActive: true,
      status: 'PUBLISHED',
    };

    assert.deepEqual(
      fieldDiff(before, { ...before, isActive: false }, AUDITED_QUESTION_FIELDS as never)?.isActive,
      { from: true, to: false },
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
   * `QuestionOption.id` is a fresh cuid on every save — `update()` deletes and recreates every
   * option — so keying this projection on `id` would report a change on every no-op resubmit.
   * `position` is the stable identity: two option sets with different ids but the same correct
   * position(s) must diff to null, the shape `update()` actually produces for an unchanged save.
   */
  it('reports no diff when a save regenerates option ids but keeps the correct position', () => {
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
    // Different option ids underneath — deleteMany + create minted new ones — same positions.
    const after = {
      correctOptionPositions: positionsOf([
        { position: 1, isCorrect: false },
        { position: 2, isCorrect: true },
      ]),
    };

    assert.equal(fieldDiff(before, after, AUDITED_QUESTION_FIELDS as never), null);
  });

  /** Marks are Decimal(6,2) from Prisma and plain numbers from the body; equal must read equal. */
  it('does not report a marks change when only the representation differs', () => {
    const before = { defaultMarks: new Prisma.Decimal('2.00') };

    assert.equal(
      fieldDiff(before, { defaultMarks: 2 } as never, AUDITED_QUESTION_FIELDS as never),
      null,
    );
    assert.deepEqual(
      fieldDiff(before, { defaultMarks: 1.5 } as never, AUDITED_QUESTION_FIELDS as never)
        ?.defaultMarks,
      { from: before.defaultMarks, to: 1.5 },
    );
  });

  /**
   * A question's active flag is a retire, not a sign-in state, so it uses ACTIVATE/DEACTIVATE
   * and never BLOCK/UNBLOCK — those belong to students.
   */
  it('uses the sign-in style toggle vocabulary for a question retire', () => {
    assert.equal(TOGGLE_ACTIONS.signIn({ isActive: false }), AUDIT_ACTION.DEACTIVATE);
  });
});

// ============================================================================
// Driving QuestionsService.update inside a live AuditContext, the way the
// interceptor actually reads it. Everything above is `fieldDiff` against
// hand-built objects, which cannot catch a wiring mistake in the service.
// ============================================================================

function build() {
  const prisma = new FakeQuestionBankPrisma([], [makeSubject()], [makeTopic()], [makeSubTopic()]);
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
    subTopicId: 'stp_1',
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
   * The one case that would have caught the original id-keyed bug: `update()` deletes and
   * recreates every option, so a save that only rewrites their text mints new option ids while
   * the correct one stays at the same position. That must report the real change (difficulty)
   * and, in the same diff, no `correctOptionPositions` entry at all.
   */
  it('reports a real change but no correctOptionPositions change when a save only regenerates option ids', async () => {
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
