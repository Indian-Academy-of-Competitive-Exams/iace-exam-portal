import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, DOCUMENT_KINDS, DOCUMENT_MAX_BYTES } from '@iace/contracts';
import { checkDocument, columnFor, documentKey } from '../src/me/documents';

const file = (over: Partial<{ size: number; mimetype: string }> = {}) => ({
  size: 1024,
  mimetype: 'image/jpeg',
  ...over,
});

describe('documentKey', () => {
  /**
   * The failure this exists to prevent: a key built from anything the client
   * controls would let one student's upload land under another's prefix, and
   * every later read of that prefix would serve the wrong person's Aadhaar.
   */
  it('puts the student id first, so an upload cannot land under someone else', () => {
    const key = documentKey('stu_1', DOCUMENT_KINDS.AADHAAR, 'application/pdf', 1_700_000_000_000);

    assert.ok(key.startsWith('students/stu_1/'), key);
  });

  it('names the kind, so the object is identifiable in the bucket', () => {
    assert.match(documentKey('stu_1', DOCUMENT_KINDS.PAN, 'image/png', 1), /\/pan-/);
  });

  /**
   * Derived from the VERIFIED content type, never the filename: "passport.jpg.exe"
   * is a filename, not a fact about the bytes.
   */
  it('takes the extension from the content type', () => {
    assert.match(documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/png', 1), /\.png$/);
    assert.match(documentKey('s', DOCUMENT_KINDS.AADHAAR, 'application/pdf', 1), /\.pdf$/);
    assert.match(documentKey('s', DOCUMENT_KINDS.PAN, 'image/webp', 1), /\.webp$/);
  });

  /**
   * A new key each time. Overwriting in place means a failed upload can leave a
   * student with a corrupt document and no way back to the one that worked.
   */
  it('never reuses a key, so a re-upload cannot destroy the old file', () => {
    const first = documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/jpeg', 1_000);
    const second = documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/jpeg', 2_000);

    assert.notEqual(first, second);
  });
});

describe('columnFor', () => {
  it('maps each kind to its own column', () => {
    assert.equal(columnFor(DOCUMENT_KINDS.PHOTO), 'photoUrl');
    assert.equal(columnFor(DOCUMENT_KINDS.AADHAAR), 'aadhaarUrl');
    assert.equal(columnFor(DOCUMENT_KINDS.PAN), 'panUrl');
  });

  it('gives every kind a distinct column', () => {
    const columns = Object.values(DOCUMENT_KINDS).map(columnFor);
    assert.equal(new Set(columns).size, columns.length, 'two kinds must not share a column');
  });
});

describe('checkDocument', () => {
  it('accepts an ordinary phone photo', () => {
    assert.doesNotThrow(() => checkDocument(DOCUMENT_KINDS.PHOTO, file()));
  });

  it('accepts a PDF for an identity document', () => {
    assert.doesNotThrow(() =>
      checkDocument(DOCUMENT_KINDS.AADHAAR, file({ mimetype: 'application/pdf' })),
    );
  });

  /**
   * A photo has to BE a photo. A PDF headshot renders as a broken box in every
   * <img> that later shows it, and nothing about the upload would have said so.
   */
  it('refuses a PDF where a photograph is meant', () => {
    assert.throws(
      () => checkDocument(DOCUMENT_KINDS.PHOTO, file({ mimetype: 'application/pdf' })),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /not accepted/);
        return true;
      },
    );
  });

  it('refuses a type nobody asked for', () => {
    for (const mimetype of ['application/zip', 'text/html', 'application/x-msdownload']) {
      assert.throws(
        () => checkDocument(DOCUMENT_KINDS.AADHAAR, file({ mimetype })),
        AppException.is,
      );
    }
  });

  it('refuses a file over the limit, and says what to do', () => {
    assert.throws(
      () => checkDocument(DOCUMENT_KINDS.PHOTO, file({ size: DOCUMENT_MAX_BYTES + 1 })),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /5MB/);
        return true;
      },
    );
  });

  it('accepts a file exactly at the limit', () => {
    assert.doesNotThrow(() =>
      checkDocument(DOCUMENT_KINDS.PHOTO, file({ size: DOCUMENT_MAX_BYTES })),
    );
  });

  it('refuses an empty file rather than storing nothing', () => {
    assert.throws(() => checkDocument(DOCUMENT_KINDS.PHOTO, file({ size: 0 })), AppException.is);
  });

  it('refuses a request that carried no file at all', () => {
    assert.throws(
      () => checkDocument(DOCUMENT_KINDS.PHOTO, undefined),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.file);
        return true;
      },
    );
  });
});
