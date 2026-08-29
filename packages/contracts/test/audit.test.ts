import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  AUDIT_WINDOW_DAYS,
  fieldDiff,
  importLogSchema,
  rowActionListQuerySchema,
  rowActionSchema,
} from '../src/audit';
import { IMPORT_LOG_STATUS } from '../src/imports';

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
      'BRANCH',
      'ADMIN',
      'QUESTION',
      'TEST',
      'TEST_SERIES',
      'BASE_CONFIG',
      'BRANCH_TEST_CONFIG',
      'EXAM_TAXONOMY',
      'TAXONOMY_SUBJECT',
      'TAXONOMY_TOPIC',
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

describe('audit read contracts', () => {
  it('carries the actor name, so a page needs no second lookup in the browser', () => {
    const row = {
      id: 'ral_1',
      feature: 'STUDENT',
      entityId: 'stu_1',
      action: 'BLOCK',
      actorType: 'ADMIN',
      actorId: 'adm_1',
      actorName: 'R Kumar',
      changed: { isTestBlocked: { from: false, to: true } },
      importLogId: null,
      createdAt: new Date().toISOString(),
    };

    assert.equal(rowActionSchema.safeParse(row).success, true);
  });

  /** An unknown actor is a script or a deleted identity, not a parse failure. */
  it('allows a row with no actor', () => {
    const parsed = rowActionSchema.safeParse({
      id: 'ral_1',
      feature: 'STUDENT',
      entityId: 'stu_1',
      action: 'IMPORT',
      actorType: 'SCRIPT',
      actorId: null,
      actorName: null,
      changed: null,
      importLogId: 'imp_1',
      createdAt: new Date().toISOString(),
    });

    assert.equal(parsed.success, true);
  });

  it('refuses an oversized page rather than quietly clamping it', () => {
    assert.equal(rowActionListQuerySchema.safeParse({ pageSize: '101' }).success, false);
    assert.equal(rowActionListQuerySchema.parse({ pageSize: '100' }).pageSize, 100);
  });

  it('states the window the screens promise', () => {
    assert.equal(AUDIT_WINDOW_DAYS, 30);
  });

  it('parses a valid import log summary', () => {
    const row = {
      id: 'imp_1',
      feature: 'STUDENT',
      source: 'SHEET',
      actorId: 'adm_1',
      actorName: 'R Kumar',
      total: 10,
      created: 8,
      updated: 1,
      skipped: 1,
      failed: 0,
      status: IMPORT_LOG_STATUS.COMMITTED,
      hasFile: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    assert.equal(importLogSchema.safeParse(row).success, true);
  });

  /** The failure this prevents: `status` was a bare string, so a fixture could assert `'DONE'` —
   *  a value nothing in the system writes — and the parse would happily accept it. */
  it('refuses a status outside IMPORT_LOG_STATUS', () => {
    const row = {
      id: 'imp_1',
      feature: 'STUDENT',
      source: 'SHEET',
      actorId: null,
      actorName: null,
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      status: 'DONE',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    assert.equal(importLogSchema.safeParse(row).success, false);
  });

  it('refuses a source outside ImportSource, so a bad column value fails loudly', () => {
    const row = {
      id: 'imp_1',
      feature: 'STUDENT',
      source: 'NOT_A_REAL_SOURCE',
      actorId: null,
      actorName: null,
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      status: IMPORT_LOG_STATUS.COMMITTED,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    assert.equal(importLogSchema.safeParse(row).success, false);
  });
});
