import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { AUDIT_ACTION, AUDIT_FEATURE, fieldDiff } from '../src/audit';

describe('fieldDiff', () => {
  it('reports only the fields that actually changed', () => {
    const diff = fieldDiff({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b']);

    assert.deepEqual(diff, { b: { from: 2, to: 3 } });
  });

  it('returns null when nothing changed, so a no-op patch writes no diff', () => {
    assert.equal(fieldDiff({ a: 1 }, { a: 1 }, ['a']), null);
  });

  it('ignores fields it was not asked about', () => {
    assert.equal(fieldDiff({ a: 1, b: 2 }, { a: 1, b: 9 }, ['a']), null);
  });

  it('treats undefined and null as the same absence', () => {
    assert.equal(fieldDiff({ a: null }, { a: undefined } as never, ['a']), null);
  });

  it('compares arrays by value, not by reference', () => {
    assert.equal(fieldDiff({ a: ['x'] }, { a: ['x'] }, ['a']), null);
    assert.deepEqual(fieldDiff({ a: ['x'] }, { a: ['x', 'y'] }, ['a']), {
      a: { from: ['x'], to: ['x', 'y'] },
    });
  });

  it('compares objects by value, not by reference', () => {
    assert.equal(fieldDiff({ a: { x: 1 } }, { a: { x: 1 } }, ['a']), null);
    assert.deepEqual(fieldDiff({ a: { x: 1 } }, { a: { x: 2 } }, ['a']), {
      a: { from: { x: 1 }, to: { x: 2 } },
    });
  });

  it('compares an object field by value regardless of key insertion order', () => {
    const before = { profile: { mother: 'Asha', father: 'Ram' } };
    const after = { profile: { father: 'Ram', mother: 'Asha' } };

    assert.equal(fieldDiff(before, after, ['profile']), null);
  });

  it('compares a nested object by value regardless of key order at any depth', () => {
    const before = { profile: { name: 'Asha', address: { city: 'Pune', zip: '411001' } } };
    const after = { profile: { address: { zip: '411001', city: 'Pune' }, name: 'Asha' } };

    assert.equal(fieldDiff(before, after, ['profile']), null);
  });

  it('still reports a diff when an object field genuinely changed, key order aside', () => {
    const before = { profile: { mother: 'Asha', father: 'Ram' } };
    const after = { profile: { father: 'Shyam', mother: 'Asha' } };

    assert.deepEqual(fieldDiff(before, after, ['profile']), {
      profile: { from: before.profile, to: after.profile },
    });
  });

  it('treats a Decimal and the equal-reading number as the same value', () => {
    const before = { marks: new Prisma.Decimal('85.50') };
    const after = { marks: 85.5 };

    assert.equal(fieldDiff(before, after as never, ['marks']), null);
  });

  it('reports a diff when a Decimal genuinely differs from the number', () => {
    const before = { marks: new Prisma.Decimal('85.50') };
    const after = { marks: 90 };

    assert.deepEqual(fieldDiff(before, after as never, ['marks']), {
      marks: { from: before.marks, to: 90 },
    });
  });

  it('treats two equal Dates as the same value', () => {
    const before = { at: new Date('2026-01-01T00:00:00.000Z') };
    const after = { at: new Date('2026-01-01T00:00:00.000Z') };

    assert.equal(fieldDiff(before, after, ['at']), null);
  });

  it('reports a diff for two different Dates', () => {
    const before = { at: new Date('2026-01-01T00:00:00.000Z') };
    const after = { at: new Date('2026-01-02T00:00:00.000Z') };

    assert.deepEqual(fieldDiff(before, after, ['at']), { at: { from: before.at, to: after.at } });
  });

  describe('on a create (no before)', () => {
    it('reports a field that received a value as new', () => {
      assert.deepEqual(fieldDiff(null, { a: 1 }, ['a']), { a: { from: null, to: 1 } });
    });

    it('drops a field that is still null but keeps one that has a value', () => {
      const diff = fieldDiff(null, { a: null, b: 1 }, ['a', 'b']);

      assert.deepEqual(diff, { b: { from: null, to: 1 } });
    });
  });
});

describe('audit vocabulary', () => {
  /** These mirror Prisma enums; a drift here is a runtime failure no type catches. */
  it('carries every feature and action the schema declares', () => {
    assert.deepEqual(Object.keys(AUDIT_FEATURE), [
      'STUDENT',
      'STUDENT_PROFILE',
      'GROUP',
      'BRANCH',
      'ADMIN',
      'QUESTION',
      'TEST',
      'EXAM_TYPE',
      'TAXONOMY',
      'FEATURE_PERMISSION',
    ]);
    assert.deepEqual(Object.keys(AUDIT_ACTION), [
      'CREATE',
      'UPDATE',
      'DELETE',
      'ACTIVATE',
      'DEACTIVATE',
      'BLOCK',
      'UNBLOCK',
      'IMPORT',
    ]);
  });

  it('uses each key as its own value, so the wire format is the enum name', () => {
    for (const [key, value] of Object.entries(AUDIT_FEATURE)) assert.equal(key, value);
    for (const [key, value] of Object.entries(AUDIT_ACTION)) assert.equal(key, value);
  });
});
