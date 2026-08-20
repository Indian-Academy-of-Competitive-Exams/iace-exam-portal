import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_EXAM_ROUTES,
  EXAM_FAMILY,
  createExamSchema,
  examListQuerySchema,
  updateExamSchema,
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
