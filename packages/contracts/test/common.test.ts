import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  csvIdQuery,
  csvQuery,
  CSV_QUERY_MAX,
  mobileSchema,
  newPinSchema,
  pinSchema,
  PIN_LENGTH,
} from '../src/index';

const parse = (
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
  v: string,
) => {
  const r = schema.safeParse(v);
  return r.success ? (r.data as string) : null;
};

describe('mobileSchema', () => {
  it('accepts a bare 10-digit number', () => {
    assert.equal(parse(mobileSchema, '9876543210'), '9876543210');
    assert.equal(parse(mobileSchema, '6000000000'), '6000000000');
  });

  it('accepts a number that BEGINS with 91 — the regression', () => {
    // 91xxxxxxxx is a live series: the prefix is only a prefix when the length says so.
    assert.equal(parse(mobileSchema, '9123456789'), '9123456789');
    assert.equal(parse(mobileSchema, '9111111119'), '9111111119');
    assert.equal(parse(mobileSchema, '9198765432'), '9198765432');
  });

  it('still strips a real country or trunk prefix', () => {
    assert.equal(parse(mobileSchema, '+919876543210'), '9876543210');
    assert.equal(parse(mobileSchema, '919876543210'), '9876543210');
    assert.equal(parse(mobileSchema, '09876543210'), '9876543210');
    assert.equal(parse(mobileSchema, '00919876543210'), '9876543210');
  });

  it('strips the prefix from a 91-series number too, when one is really there', () => {
    assert.equal(parse(mobileSchema, '+919123456789'), '9123456789');
    assert.equal(parse(mobileSchema, '919123456789'), '9123456789');
  });

  it('ignores spaces, hyphens and parentheses', () => {
    assert.equal(parse(mobileSchema, '  +91 98765-43210 '), '9876543210');
    assert.equal(parse(mobileSchema, '(091) 91234 56789'.replace('(091)', '+91')), '9123456789');
  });

  it('rejects what is genuinely not a mobile number', () => {
    for (const bad of ['123456789', '12345678901', '5876543210', '', 'abcdefghij', '98765 4321']) {
      assert.equal(parse(mobileSchema, bad), null, `expected ${bad} to be rejected`);
    }
  });
});

describe('pinSchema', () => {
  it('takes exactly PIN_LENGTH digits', () => {
    assert.equal(PIN_LENGTH, 4);
    assert.equal(parse(pinSchema, '4813'), '4813');
    assert.equal(parse(pinSchema, ' 4813 '), '4813');
    assert.equal(parse(pinSchema, '481'), null);
    assert.equal(parse(pinSchema, '48130'), null);
    assert.equal(parse(pinSchema, '48a3'), null);
  });

  it('accepts a weak PIN at LOGIN — the rules only apply when choosing one', () => {
    // Rejecting 1111 here would lock out an account that already has it.
    assert.equal(parse(pinSchema, '1111'), '1111');
    assert.equal(parse(pinSchema, '1234'), '1234');
  });
});

describe('newPinSchema', () => {
  it('refuses the shapes an attacker tries first', () => {
    for (const weak of ['0000', '1111', '9999', '1234', '4321', '2345', '0123', '3210']) {
      assert.equal(parse(newPinSchema, weak), null, `expected ${weak} to be refused`);
    }
  });

  it('allows an ordinary PIN', () => {
    for (const ok of ['4813', '7261', '1122', '2580', '1032']) {
      assert.equal(parse(newPinSchema, ok), ok);
    }
  });
});

describe('csvQuery', () => {
  const status = csvQuery(z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']));
  const ids = csvIdQuery();
  const read = (
    schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
    v?: string,
  ) => {
    const r = schema.safeParse(v);
    return r.success ? (r.data as string[] | undefined) : null;
  };

  it('reads several values from one param', () => {
    assert.deepEqual(read(ids, 'sub_1,sub_2'), ['sub_1', 'sub_2']);
    assert.deepEqual(read(status, 'DRAFT,ACTIVE'), ['DRAFT', 'ACTIVE']);
  });

  it('reads a single value as a set of one', () => {
    assert.deepEqual(read(ids, 'sub_1'), ['sub_1']);
  });

  /** `in: []` matches NOTHING in Prisma, so an empty filter has to arrive as undefined. */
  it('is absent, never an empty set', () => {
    assert.equal(read(ids, undefined), undefined);
    assert.equal(read(ids, ''), undefined);
    assert.equal(read(ids, ','), undefined);
    assert.equal(read(ids, ' , , '), undefined);
  });

  it('ignores the gaps a hand-edited URL leaves', () => {
    assert.deepEqual(read(ids, 'sub_1,,sub_2,'), ['sub_1', 'sub_2']);
    assert.deepEqual(read(ids, ' sub_1 , sub_2 '), ['sub_1', 'sub_2']);
  });

  it('keeps one of each, so a repeat cannot widen the IN list', () => {
    assert.deepEqual(read(ids, 'sub_1,sub_1,sub_2'), ['sub_1', 'sub_2']);
  });

  it('refuses an unknown member, exactly as a single-value enum does', () => {
    assert.equal(read(status, 'DRAFT,NONSENSE'), null);
    assert.equal(read(status, 'NONSENSE'), null);
  });

  it('refuses more members than an IN list should carry', () => {
    const tooMany = Array.from({ length: CSV_QUERY_MAX + 1 }, (_, i) => `id_${i}`).join(',');
    assert.equal(read(ids, tooMany), null);
    assert.equal(
      read(ids, tooMany.split(',').slice(0, CSV_QUERY_MAX).join(','))?.length,
      CSV_QUERY_MAX,
    );
  });
});
