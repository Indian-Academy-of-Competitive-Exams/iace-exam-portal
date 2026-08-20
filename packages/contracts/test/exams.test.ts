import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_EXAM_ROUTES,
  ADMIN_EXAM_STAGE_ROUTES,
  EXAM_FAMILY,
  STAGE_DISPOSITION,
  createExamSchema,
  createExamStageSchema,
  examListQuerySchema,
  stageTakesConfigs,
  updateExamSchema,
  updateExamStageSchema,
} from '../src/index';

/**
 * The code is what `Student.enrolledExams` stores, with no foreign key behind it. A code that is
 * not canonical is a code nothing will ever match again.
 */
describe('createExamSchema', () => {
  it('normalises the code on the way in', () => {
    assert.deepEqual(
      createExamSchema.parse({ family: EXAM_FAMILY.SSC, name: 'SSC CGL', code: ' ssc  cgl ' }),
      { family: EXAM_FAMILY.SSC, name: 'SSC CGL', code: 'SSC CGL' },
    );
  });

  it('refuses a code that cannot be tidied into the canonical form', () => {
    assert.equal(
      createExamSchema.safeParse({ family: EXAM_FAMILY.SSC, name: 'SSC CGL', code: 'SSC-CGL' })
        .success,
      false,
    );
  });

  /** The family is a fixed set, not a table: onboarding a new one is a migration. */
  it('refuses a family nothing in the schema names', () => {
    assert.equal(
      createExamSchema.safeParse({ family: 'UPSC', name: 'UPSC CSE', code: 'UPSC CSE' }).success,
      false,
    );
  });

  /** The name is display text — it keeps its case, and only its edges are trimmed. */
  it('trims the name but leaves its shape alone', () => {
    assert.equal(
      createExamSchema.parse({
        family: EXAM_FAMILY.RRB,
        name: '  RRB Junior Engineer ',
        code: 'RRB JE',
      }).name,
      'RRB Junior Engineer',
    );
  });

  it('refuses a name of one character', () => {
    assert.equal(
      createExamSchema.safeParse({ family: EXAM_FAMILY.SSC, name: 'S', code: 'SSC' }).success,
      false,
    );
  });
});

describe('updateExamSchema', () => {
  it('accepts a retire with nothing else in the body', () => {
    assert.deepEqual(updateExamSchema.parse({ isActive: false }), { isActive: false });
  });

  it('canonicalises a code change too, so the refusal is judged on the real value', () => {
    assert.equal(updateExamSchema.parse({ code: 'ssc chsl' }).code, 'SSC CHSL');
  });
});

describe('examListQuerySchema', () => {
  it('reads activeOnly as the boolean the service branches on', () => {
    const query = examListQuerySchema.parse({ page: '1', pageSize: '20', activeOnly: 'true' });
    assert.equal(query.activeOnly, true);
    assert.equal(examListQuerySchema.parse({}).activeOnly, undefined);
  });

  it('drops an empty search rather than filtering on nothing', () => {
    assert.equal(examListQuerySchema.parse({ q: '   ' }).q, undefined);
  });
});

describe('ADMIN_EXAM_ROUTES', () => {
  it('addresses one exam by id', () => {
    assert.equal(ADMIN_EXAM_ROUTES.update('exam_1'), '/admin/exams/exam_1');
    assert.equal(ADMIN_EXAM_ROUTES.remove('exam_1'), '/admin/exams/exam_1');
  });
});

/**
 * The key is what a seed script and the exam-pattern workbook address a stage by. Underscores,
 * not spaces — and normalised rather than refused, so a typed "ssc cgl t1" still lands on it.
 */
describe('createExamStageSchema', () => {
  const stage = { examId: 'exam_1', stageKey: 'SSC_CGL_T1', name: 'Tier 1' };

  it('normalises the key into the form every script uses', () => {
    assert.equal(
      createExamStageSchema.parse({ ...stage, stageKey: ' ssc cgl t1 ' }).stageKey,
      'SSC_CGL_T1',
    );
    assert.equal(
      createExamStageSchema.parse({ ...stage, stageKey: 'ssc-cgl-t1' }).stageKey,
      'SSC_CGL_T1',
    );
  });

  it('refuses a key that cannot be tidied into that form', () => {
    assert.equal(createExamStageSchema.safeParse({ ...stage, stageKey: '1ST' }).success, false);
    assert.equal(createExamStageSchema.safeParse({ ...stage, stageKey: 'T1!' }).success, false);
  });

  it('coerces the order, because a form field arrives as a string', () => {
    assert.equal(createExamStageSchema.parse({ ...stage, order: '2' }).order, 2);
  });

  it('leaves mode and disposition to the column defaults when nobody named them', () => {
    const parsed = createExamStageSchema.parse(stage);
    assert.equal(parsed.mode, undefined);
    assert.equal(parsed.disposition, undefined);
  });

  it('needs an exam to hang off', () => {
    assert.equal(
      createExamStageSchema.safeParse({ stageKey: 'SSC_CGL_T1', name: 'T1' }).success,
      false,
    );
  });
});

describe('updateExamStageSchema', () => {
  /** A stage never moves exam: every config, series and test under it would change meaning. */
  it('carries no examId, so a patch cannot move a stage between exams', () => {
    const parsed = updateExamStageSchema.parse({ examId: 'exam_2', name: 'Prelims' });

    assert.equal('examId' in parsed, false);
    assert.equal(parsed.name, 'Prelims');
  });

  it('accepts a retire with nothing else in the body', () => {
    assert.deepEqual(updateExamStageSchema.parse({ isActive: false }), { isActive: false });
  });
});

describe('stageTakesConfigs', () => {
  /** A stage listed only for the journey's sake never carries a mock. */
  it('is true for the two dispositions that are sat, and false for the listing', () => {
    assert.equal(stageTakesConfigs(STAGE_DISPOSITION.CONDUCTED), true);
    assert.equal(stageTakesConfigs(STAGE_DISPOSITION.PARTIAL), true);
    assert.equal(stageTakesConfigs(STAGE_DISPOSITION.CATALOG_ONLY), false);
  });
});

describe('ADMIN_EXAM_STAGE_ROUTES', () => {
  it('addresses one stage by id, off its own collection', () => {
    assert.equal(ADMIN_EXAM_STAGE_ROUTES.update('stage_1'), '/admin/exam-stages/stage_1');
    assert.equal(ADMIN_EXAM_STAGE_ROUTES.remove('stage_1'), '/admin/exam-stages/stage_1');
  });
});
