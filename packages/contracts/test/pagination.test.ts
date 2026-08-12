import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PAGE_SIZE_OPTIONS,
  isPageSizeOption,
  paginationQuerySchema,
} from '../src/envelope';

/**
 * The options the UI offers and the cap the API enforces live beside each
 * other so they cannot drift. These tests are what makes that true: a picker
 * offering a size the server refuses is a control that looks generous and is
 * simply broken.
 */
describe('page size options', () => {
  it('every offered size is one the API will accept', () => {
    for (const size of PAGE_SIZE_OPTIONS) {
      const parsed = paginationQuerySchema.safeParse({ pageSize: String(size) });
      assert.equal(parsed.success, true, `pageSize=${size} must be accepted`);
      assert.equal(parsed.data?.pageSize, size);
    }
  });

  it('no option exceeds the cap', () => {
    for (const size of PAGE_SIZE_OPTIONS) {
      assert.ok(size <= PAGE_SIZE_MAX, `${size} exceeds PAGE_SIZE_MAX (${PAGE_SIZE_MAX})`);
    }
  });

  it('the default is one of the options, so the picker can show what is in use', () => {
    assert.ok(isPageSizeOption(PAGE_SIZE_DEFAULT));
  });

  it('rejects sizes the app does not offer, including a plausible-looking one', () => {
    assert.equal(isPageSizeOption(25), false);
    assert.equal(isPageSizeOption(0), false);
    assert.equal(isPageSizeOption(-20), false);
    assert.equal(isPageSizeOption(PAGE_SIZE_MAX + 1), false);
  });

  /**
   * The failure this prevents: a stored preference — a stale localStorage
   * value, a hand-edited one — is sent verbatim and every list 400s until the
   * reader thinks to clear their browser storage.
   */
  it('rejects the shapes a persisted preference degrades into', () => {
    assert.equal(isPageSizeOption('20'), false);
    assert.equal(isPageSizeOption(null), false);
    assert.equal(isPageSizeOption(undefined), false);
    assert.equal(isPageSizeOption(Number.NaN), false);
  });

  it('caps a page size the API is asked for beyond the maximum', () => {
    assert.equal(paginationQuerySchema.safeParse({ pageSize: '1000' }).success, false);
  });
});
