import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDIT_FEATURE, fieldDiff } from '@iace/contracts';
import { AUDITED_EXAM_TYPE_FIELDS } from '../src/configs/exam-types.service';
import { AUDIT_KEY, type AuditRoute } from '../src/audit/audit.decorator';
import { TaxonomyController } from '../src/questions/taxonomy.controller';
import {
  AUDITED_SUBJECT_FIELDS,
  AUDITED_SUB_TOPIC_FIELDS,
  AUDITED_TOPIC_FIELDS,
} from '../src/questions/taxonomy.service';

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
