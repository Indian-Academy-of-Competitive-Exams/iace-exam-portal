import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_EXAM_TYPE_ROUTES,
  createExamTypeSchema,
  examTypeListQuerySchema,
  updateExamTypeSchema,
} from '../src/index';

/**
 * The code is what `Group.examType` and `Student.enrolledExams` store, with no foreign key behind
 * it. A code that is not canonical is a code nothing will ever match again.
 */
describe('createExamTypeSchema', () => {
  it('normalises the code on the way in', () => {
    assert.deepEqual(createExamTypeSchema.parse({ name: 'SSC CGL', code: ' ssc  cgl ' }), {
      name: 'SSC CGL',
      code: 'SSC CGL',
    });
  });

  it('refuses a code that cannot be tidied into the canonical form', () => {
    assert.equal(
      createExamTypeSchema.safeParse({ name: 'SSC CGL', code: 'SSC-CGL' }).success,
      false,
    );
  });

  /** The name is display text — it keeps its case, and only its edges are trimmed. */
  it('trims the name but leaves its shape alone', () => {
    assert.equal(
      createExamTypeSchema.parse({ name: '  RRB Junior Engineer ', code: 'RRB JE' }).name,
      'RRB Junior Engineer',
    );
  });

  it('refuses a name of one character', () => {
    assert.equal(createExamTypeSchema.safeParse({ name: 'S', code: 'SSC' }).success, false);
  });
});

describe('updateExamTypeSchema', () => {
  it('accepts a retire with nothing else in the body', () => {
    assert.deepEqual(updateExamTypeSchema.parse({ isActive: false }), { isActive: false });
  });

  it('canonicalises a code change too, so the refusal is judged on the real value', () => {
    assert.equal(updateExamTypeSchema.parse({ code: 'ssc chsl' }).code, 'SSC CHSL');
  });
});

describe('examTypeListQuerySchema', () => {
  it('reads activeOnly as the boolean the service branches on', () => {
    const query = examTypeListQuerySchema.parse({ page: '1', pageSize: '20', activeOnly: 'true' });
    assert.equal(query.activeOnly, true);
    assert.equal(examTypeListQuerySchema.parse({}).activeOnly, undefined);
  });

  it('drops an empty search rather than filtering on nothing', () => {
    assert.equal(examTypeListQuerySchema.parse({ q: '   ' }).q, undefined);
  });
});

describe('ADMIN_EXAM_TYPE_ROUTES', () => {
  it('addresses one exam type by id', () => {
    assert.equal(ADMIN_EXAM_TYPE_ROUTES.update('ext_1'), '/admin/exam-types/ext_1');
    assert.equal(ADMIN_EXAM_TYPE_ROUTES.remove('ext_1'), '/admin/exam-types/ext_1');
  });
});
