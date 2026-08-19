import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_FEATURE, fieldDiff } from '@iace/contracts';
import { AUDITED_EXAM_TYPE_FIELDS, ExamTypesService } from '../src/configs/exam-types.service';
import { AUDIT_KEY, type AuditRoute } from '../src/audit/audit.decorator';
import { TaxonomyController } from '../src/questions/taxonomy.controller';
import {
  AUDITED_SUBJECT_FIELDS,
  AUDITED_SUB_TOPIC_FIELDS,
  AUDITED_TOPIC_FIELDS,
  TaxonomyService,
} from '../src/questions/taxonomy.service';
import { AuditContext } from '../src/audit';
import { GroupsService } from '../src/groups';
import { StudentsService } from '../src/students';
import {
  FakePrisma,
  FakeQuestionBankPrisma,
  makeExamType,
  makeSubTopic,
  makeSubject,
  makeTopic,
} from './support/fakes';

describe('the exam type audit diff', () => {
  it('covers every column an exam type edit can change', () => {
    assert.deepEqual([...AUDITED_EXAM_TYPE_FIELDS], ['name', 'code', 'isActive']);
  });

  /**
   * The code is what groups and enrolments store, so a change to it is the one an admin will
   * come looking for. It is refused once anything references it — before that, it is loggable.
   */
  it('reports a code change', () => {
    const before = { name: 'SSC CGL', code: 'SSC CGL', isActive: true };

    assert.deepEqual(
      fieldDiff(before, { ...before, code: 'SSC CGL T1' }, AUDITED_EXAM_TYPE_FIELDS),
      {
        code: { from: 'SSC CGL', to: 'SSC CGL T1' },
      },
    );
  });
});

describe('the taxonomy audit diffs', () => {
  it('covers what each level can change', () => {
    assert.deepEqual([...AUDITED_SUBJECT_FIELDS], ['name', 'code']);
    assert.deepEqual([...AUDITED_TOPIC_FIELDS], ['name']);
    assert.deepEqual([...AUDITED_SUB_TOPIC_FIELDS], ['name', 'topicIds']);
  });

  /** A sub-topic is shared across topics, so renaming one moves it for every topic at once. */
  it('reports a sub-topic rename', () => {
    const before = { name: 'ALGEBRA', topicIds: ['top_1'] };

    assert.deepEqual(
      fieldDiff(before, { ...before, name: 'ALGEBRA BASICS' }, AUDITED_SUB_TOPIC_FIELDS),
      {
        name: { from: 'ALGEBRA', to: 'ALGEBRA BASICS' },
      },
    );
  });

  /**
   * `topicIds` is the M:N relation flattened to ids: relinking a sub-topic moves it for every
   * topic on both sides at once, and that is exactly the change the audit log exists to find.
   */
  it('reports a sub-topic relink', () => {
    const before = { name: 'PERCENTAGES', topicIds: ['top_1'] };
    const after = { name: 'PERCENTAGES', topicIds: ['top_1', 'top_2'] };

    assert.deepEqual(fieldDiff(before, after, AUDITED_SUB_TOPIC_FIELDS), {
      topicIds: { from: ['top_1'], to: ['top_1', 'top_2'] },
    });
  });

  it('reports no diff when the topic set does not change', () => {
    const before = { name: 'PERCENTAGES', topicIds: ['top_1', 'top_2'] };
    const after = { name: 'PERCENTAGES', topicIds: ['top_1', 'top_2'] };

    assert.equal(fieldDiff(before, after, AUDITED_SUB_TOPIC_FIELDS), null);
  });
});

/**
 * The failure this prevents: with one AuditFeature value for all three levels, a subject edit
 * and a sub-topic edit were indistinguishable except by looking `entityId` up in every table —
 * which fails for exactly the DELETE rows the log matters most for, since the id it names is
 * already gone.
 */
describe('the taxonomy routes file under three distinct features', () => {
  const featureOf = (handler: keyof TaxonomyController) =>
    (Reflect.getMetadata(AUDIT_KEY, TaxonomyController.prototype[handler]) as AuditRoute).feature;

  it('gives each level its own AuditFeature, on both its create and its update route', () => {
    assert.equal(featureOf('createSubject'), AUDIT_FEATURE.TAXONOMY_SUBJECT);
    assert.equal(featureOf('updateSubject'), AUDIT_FEATURE.TAXONOMY_SUBJECT);
    assert.equal(featureOf('createTopic'), AUDIT_FEATURE.TAXONOMY_TOPIC);
    assert.equal(featureOf('updateTopic'), AUDIT_FEATURE.TAXONOMY_TOPIC);
    assert.equal(featureOf('createSubTopic'), AUDIT_FEATURE.TAXONOMY_SUB_TOPIC);
    assert.equal(featureOf('updateSubTopic'), AUDIT_FEATURE.TAXONOMY_SUB_TOPIC);
  });

  it('never lets two levels share a value', () => {
    const features = [
      featureOf('createSubject'),
      featureOf('createTopic'),
      featureOf('createSubTopic'),
    ];
    assert.equal(new Set(features).size, 3);
  });
});

// ============================================================================
// Driving the real services inside a live AuditContext, the way the interceptor
// actually reads it. Everything above is `fieldDiff` against hand-built objects,
// which cannot catch a wiring mistake in the service or in the fake it runs
// against. `updateSubject`/`updateTopic` could not even be driven this way until
// now — `FakeQuestionBankPrisma.subject`/`.topic` had no `update` at all — and
// `.subTopic.findUnique` handed back the same row `update` then mutated, so its
// diff would have read `null` too.
// ============================================================================

describe('ExamTypesService.update — driven live, the diff a real edit contributes', () => {
  it('reports a rename', async () => {
    const prisma = new FakePrisma(
      [],
      [],
      [],
      [],
      [makeExamType({ id: 'ext_1', name: 'SSC CGL', code: 'SSC CGL' })],
    );
    const auditContext = new AuditContext();
    const service = new ExamTypesService(
      prisma.asService(),
      new GroupsService(prisma.asService(), null as never, null as never, new AuditContext()),
      new StudentsService(
        prisma.asService(),
        null as never,
        null as never,
        null as never,
        new AuditContext(),
      ),
      auditContext,
    );

    await auditContext.run(async () => {
      await service.update('ext_1', { name: 'SSC CGL TIER 1' });
      assert.deepEqual(auditContext.current()?.changed, {
        name: { from: 'SSC CGL', to: 'SSC CGL TIER 1' },
      });
    });
  });
});

describe('TaxonomyService.updateSubject — driven live, the diff a real edit contributes', () => {
  it('reports a code change', async () => {
    const prisma = new FakeQuestionBankPrisma(
      [],
      [makeSubject({ id: 'sub_1', name: 'QUANTITATIVE APTITUDE', code: null })],
    );
    const auditContext = new AuditContext();
    const service = new TaxonomyService(prisma.asService(), auditContext);

    await auditContext.run(async () => {
      await service.updateSubject('sub_1', { code: 'QA' });
      assert.deepEqual(auditContext.current()?.changed, { code: { from: null, to: 'QA' } });
    });
  });
});

describe('TaxonomyService.updateTopic — driven live, the diff a real edit contributes', () => {
  it('reports a rename', async () => {
    const prisma = new FakeQuestionBankPrisma(
      [],
      [makeSubject({ id: 'sub_1' })],
      [makeTopic({ id: 'top_1', name: 'ARITHMETIC', subjectId: 'sub_1' })],
    );
    const auditContext = new AuditContext();
    const service = new TaxonomyService(prisma.asService(), auditContext);

    await auditContext.run(async () => {
      await service.updateTopic('top_1', { name: 'ARITHMETIC BASICS' });
      assert.deepEqual(auditContext.current()?.changed, {
        name: { from: 'ARITHMETIC', to: 'ARITHMETIC BASICS' },
      });
    });
  });
});

describe('TaxonomyService.updateSubTopic — driven live, the diff a real edit contributes', () => {
  it('reports a rename', async () => {
    const prisma = new FakeQuestionBankPrisma(
      [],
      [],
      [makeTopic({ id: 'top_1' })],
      [makeSubTopic({ id: 'stp_1', name: 'ALGEBRA', topicIds: ['top_1'] })],
    );
    const auditContext = new AuditContext();
    const service = new TaxonomyService(prisma.asService(), auditContext);

    await auditContext.run(async () => {
      await service.updateSubTopic('stp_1', { name: 'ALGEBRA BASICS' });
      assert.deepEqual(auditContext.current()?.changed, {
        name: { from: 'ALGEBRA', to: 'ALGEBRA BASICS' },
      });
    });
  });
});
