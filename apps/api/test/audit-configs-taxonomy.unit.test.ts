import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_FEATURE, fieldDiff } from '@iace/contracts';
import { AUDITED_EXAM_FIELDS, ExamsService } from '../src/configs/exams.service';
import { AUDIT_KEY, type AuditRoute } from '../src/audit/audit.decorator';
import { TaxonomyController } from '../src/questions/taxonomy.controller';
import {
  AUDITED_SUBJECT_FIELDS,
  AUDITED_TOPIC_FIELDS,
  TaxonomyService,
} from '../src/questions/taxonomy.service';
import { AuditContext } from '../src/audit';
import { StudentsService } from '../src/students';
import {
  fakeStartingPins,
  FakeEventBus,
  FakePrisma,
  FakeQuestionBankPrisma,
  makeExam,
  makeSubject,
  makeTopic,
} from './support/fakes';

describe('the exam audit diff', () => {
  it('covers every column an exam edit can change', () => {
    assert.deepEqual(
      [...AUDITED_EXAM_FIELDS],
      ['family', 'name', 'code', 'description', 'isActive'],
    );
  });

  /**
   * The code is what an enrolment stores, so a change to it is the one an admin will come
   * looking for. It is refused once anything references it — before that, it is loggable.
   */
  it('reports a code change', () => {
    const before = {
      family: 'SSC',
      name: 'SSC CGL',
      code: 'SSC CGL',
      description: null,
      isActive: true,
    };

    assert.deepEqual(fieldDiff(before, { ...before, code: 'SSC CGL T1' }, AUDITED_EXAM_FIELDS), {
      code: { from: 'SSC CGL', to: 'SSC CGL T1' },
    });
  });
});

describe('the taxonomy audit diffs', () => {
  it('covers what each level can change', () => {
    assert.deepEqual([...AUDITED_SUBJECT_FIELDS], ['name', 'code']);
    assert.deepEqual([...AUDITED_TOPIC_FIELDS], ['name']);
  });

  /** A topic name is what every question under it is filed by, so a rename is worth finding. */
  it('reports a topic rename', () => {
    const before = { name: 'ALGEBRA' };

    assert.deepEqual(fieldDiff(before, { name: 'ALGEBRA BASICS' }, AUDITED_TOPIC_FIELDS), {
      name: { from: 'ALGEBRA', to: 'ALGEBRA BASICS' },
    });
  });

  it('reports no diff when the name does not change', () => {
    assert.equal(
      fieldDiff({ name: 'PERCENTAGES' }, { name: 'PERCENTAGES' }, AUDITED_TOPIC_FIELDS),
      null,
    );
  });
});

/**
 * The failure this prevents: with one AuditFeature value for both levels, a subject edit and a
 * topic edit were indistinguishable except by looking `entityId` up in every table — which fails
 * for exactly the DELETE rows the log matters most for, since the id it names is already gone.
 */
describe('the taxonomy routes file under two distinct features', () => {
  const featureOf = (handler: keyof TaxonomyController) =>
    (Reflect.getMetadata(AUDIT_KEY, TaxonomyController.prototype[handler]) as AuditRoute).feature;

  it('gives each level its own AuditFeature, on both its create and its update route', () => {
    assert.equal(featureOf('createSubject'), AUDIT_FEATURE.TAXONOMY_SUBJECT);
    assert.equal(featureOf('updateSubject'), AUDIT_FEATURE.TAXONOMY_SUBJECT);
    assert.equal(featureOf('createTopic'), AUDIT_FEATURE.TAXONOMY_TOPIC);
    assert.equal(featureOf('updateTopic'), AUDIT_FEATURE.TAXONOMY_TOPIC);
  });

  it('never lets two levels share a value', () => {
    const features = [featureOf('createSubject'), featureOf('createTopic')];
    assert.equal(new Set(features).size, 2);
  });
});

// ============================================================================
// Driving the real services inside a live AuditContext, the way the interceptor
// actually reads it. Everything above is `fieldDiff` against hand-built objects,
// which cannot catch a wiring mistake in the service or in the fake it runs
// against.
// ============================================================================

describe('ExamsService.update — driven live, the diff a real edit contributes', () => {
  it('reports a rename', async () => {
    const prisma = new FakePrisma(
      [],
      [],
      [],
      [makeExam({ id: 'exam_1', name: 'SSC CGL', code: 'SSC CGL' })],
    );
    const auditContext = new AuditContext();
    const service = new ExamsService(
      prisma.asService(),
      new StudentsService(
        prisma.asService(),
        null as never,
        null as never,
        null as never,
        fakeStartingPins(),
        null as never,
        new AuditContext(),
        new FakeEventBus().asService(),
      ),
      auditContext,
    );

    await auditContext.run(async () => {
      await service.update('exam_1', { name: 'SSC CGL TIER 1' });
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
