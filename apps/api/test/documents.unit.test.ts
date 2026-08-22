import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, DOCUMENT_KINDS, DOCUMENT_MAX_BYTES } from '@iace/contracts';
import { checkDocument, columnFor, documentKey } from '../src/me/documents';

const { PHOTO, TENTH_MARKSHEET } = DOCUMENT_KINDS;

const file = (over: Partial<{ size: number; mimetype: string }> = {}) => ({
  size: 1024,
  mimetype: 'image/jpeg',
  ...over,
});

describe('documentKey', () => {
  /**
   * The failure this exists to prevent: a key built from anything the client controls would let one
   * student's upload land under another's prefix, and every later read of that prefix would serve
   * the wrong person's photo.
   */
  it('puts the student id first, so an upload cannot land under someone else', () => {
    const key = documentKey('stu_1', DOCUMENT_KINDS.PHOTO, 'image/jpeg', 1_700_000_000_000);

    assert.ok(key.startsWith('students/stu_1/'), key);
  });

  it('names the kind, so the object is identifiable in the bucket', () => {
    assert.match(documentKey('stu_1', DOCUMENT_KINDS.PHOTO, 'image/png', 1), /\/photo-/);
  });

  /**
   * Derived from the VERIFIED content type, never the filename: "passport.jpg.exe" is a filename,
   * not a fact about the bytes.
   */
  it('takes the extension from the content type', () => {
    assert.match(documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/png', 1), /\.png$/);
    assert.match(documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/webp', 1), /\.webp$/);
  });

  /**
   * A new key each time. Overwriting in place means a failed upload can leave a student with a
   * corrupt document and no way back to the one that worked.
   */
  it('never reuses a key, so a re-upload cannot destroy the old file', () => {
    const first = documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/jpeg', 1_000);
    const second = documentKey('s', DOCUMENT_KINDS.PHOTO, 'image/jpeg', 2_000);

    assert.notEqual(first, second);
  });
});

describe('columnFor', () => {
  /** Aadhaar and PAN are not here: their images are never stored, only a verified flag. */
  it('maps each kind to its own column', () => {
    assert.equal(columnFor(PHOTO), 'photoUrl');
    assert.equal(columnFor(TENTH_MARKSHEET), 'tenthMarksheetUrl');
  });

  it('gives every kind a distinct column', () => {
    const columns = Object.values(DOCUMENT_KINDS).map(columnFor);
    assert.equal(new Set(columns).size, columns.length, 'two kinds must not share a column');
  });
});

describe('checkDocument', () => {
  it('accepts an ordinary phone photo', () => {
    assert.doesNotThrow(() => checkDocument(file(), PHOTO));
  });

  /**
   * A photo has to BE a photo. A PDF headshot renders as a broken box in every <img> that later
   * shows it, and nothing about the upload would have said so.
   */
  it('refuses a PDF where a photograph is meant', () => {
    assert.throws(
      () => checkDocument(file({ mimetype: 'application/pdf' }), PHOTO),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /not accepted/);
        return true;
      },
    );
  });

  it('refuses a type nobody asked for', () => {
    for (const mimetype of ['application/zip', 'text/html', 'application/x-msdownload']) {
      assert.throws(() => checkDocument(file({ mimetype }), PHOTO), AppException.is);
    }
  });

  it('refuses a file over the limit, and says what to do', () => {
    assert.throws(
      () => checkDocument(file({ size: DOCUMENT_MAX_BYTES + 1 }), PHOTO),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /5MB/);
        return true;
      },
    );
  });

  it('accepts a file exactly at the limit', () => {
    assert.doesNotThrow(() => checkDocument(file({ size: DOCUMENT_MAX_BYTES }), PHOTO));
  });

  it('refuses an empty file rather than storing nothing', () => {
    assert.throws(() => checkDocument(file({ size: 0 }), PHOTO), AppException.is);
  });

  /** The kind decides, not a single list: a scanned certificate is a PDF far more often than not. */
  it('takes a PDF for a marksheet, having refused one for a photo', () => {
    assert.doesNotThrow(() =>
      checkDocument(file({ mimetype: 'application/pdf' }), TENTH_MARKSHEET),
    );
  });

  it('still refuses a type nobody asked for, whichever kind it is', () => {
    assert.throws(
      () => checkDocument(file({ mimetype: 'text/html' }), TENTH_MARKSHEET),
      AppException.is,
    );
  });

  it('holds the size limit for every kind', () => {
    assert.throws(
      () => checkDocument(file({ size: DOCUMENT_MAX_BYTES + 1 }), TENTH_MARKSHEET),
      AppException.is,
    );
  });

  it('refuses a request that carried no file at all', () => {
    assert.throws(
      () => checkDocument(undefined, PHOTO),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.file);
        return true;
      },
    );
  });
});
