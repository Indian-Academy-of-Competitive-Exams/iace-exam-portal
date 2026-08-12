import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { applyFieldErrors, bannerMessage, isFullyFieldMapped } from '../src/form-errors';

const failure = (
  fieldErrors: Record<string, string[]>,
  message = 'Some of the details are not valid',
) => new AppException(ErrorCodes.VALIDATION_ERROR, message, { fieldErrors });

describe('applyFieldErrors', () => {
  it('puts a message on the field that caused it', () => {
    const set: Record<string, string> = {};
    applyFieldErrors(
      failure({ mobile: ['That is not a valid mobile number'] }),
      ((field: string, error: { message?: string }) => {
        set[field] = error.message ?? '';
      }) as never,
      ['mobile'] as never,
    );

    assert.equal(set.mobile, 'That is not a valid mobile number');
  });

  /**
   * The server keys nested problems by their full path (`profile.dob`) while a
   * form registers flat names (`dob`). Without leaf matching the message is
   * dropped, the field is never highlighted, and the form looks inert.
   */
  it('matches a nested server path against the flat name a form registered', () => {
    const set: Record<string, string> = {};
    applyFieldErrors(
      failure({ 'profile.dob': ['A date of birth cannot be in the future'] }),
      ((field: string, error: { message?: string }) => {
        set[field] = error.message ?? '';
      }) as never,
      ['dob'] as never,
    );

    assert.equal(set.dob, 'A date of birth cannot be in the future');
  });

  it('ignores an error for a field this form does not have', () => {
    const set: Record<string, string> = {};
    applyFieldErrors(
      failure({ somethingElse: ['nope'] }),
      ((field: string) => {
        set[field] = 'set';
      }) as never,
      ['mobile'] as never,
    );

    assert.deepEqual(set, {});
  });

  it('does nothing for an error that carries no field errors at all', () => {
    const set: Record<string, string> = {};
    applyFieldErrors(
      new AppException(ErrorCodes.INTERNAL, 'boom'),
      ((field: string) => {
        set[field] = 'set';
      }) as never,
      ['mobile'] as never,
    );

    assert.deepEqual(set, {});
  });
});

describe('bannerMessage', () => {
  it('stays silent when every message already sits on a field', () => {
    assert.equal(bannerMessage(failure({ mobile: ['bad'] }), ['mobile']), null);
  });

  it('speaks when a message has nowhere else to go', () => {
    assert.equal(
      bannerMessage(failure({ unknownField: ['bad'] }, 'Could not save'), ['mobile']),
      'Could not save',
    );
  });

  it('counts a nested path as mapped when the form has its leaf', () => {
    assert.equal(isFullyFieldMapped(failure({ 'profile.dob': ['bad'] }), ['dob']), true);
  });

  it('falls back to something sayable for an error it does not recognise', () => {
    assert.match(bannerMessage(new Error('network down')) ?? '', /went wrong/);
  });

  it('says nothing when there is no error', () => {
    assert.equal(bannerMessage(null), null);
    assert.equal(bannerMessage(undefined), null);
  });
});
