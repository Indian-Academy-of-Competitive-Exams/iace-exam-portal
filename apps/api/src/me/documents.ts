import {
  AppException,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_BYTES,
  ErrorCodes,
  acceptedTypesFor,
  type DocumentKind,
} from '@iace/contracts';

/**
 * The rules for a student's uploaded photo and identity documents.
 *
 * Pure, so they can be checked without S3 or a database — which matters here
 * more than most places, because the failure modes are quiet: a file accepted
 * under the wrong extension, or a key that lets one student's upload land on
 * another's record.
 */

/** Which profile column each kind writes to. The client never chooses this. */
const COLUMN_FOR: Record<DocumentKind, 'photoUrl' | 'aadhaarUrl' | 'panUrl'> = {
  [DOCUMENT_KINDS.PHOTO]: 'photoUrl',
  [DOCUMENT_KINDS.AADHAAR]: 'aadhaarUrl',
  [DOCUMENT_KINDS.PAN]: 'panUrl',
};

export function columnFor(kind: DocumentKind): 'photoUrl' | 'aadhaarUrl' | 'panUrl' {
  return COLUMN_FOR[kind];
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Where an upload is stored.
 *
 * The student id comes from the TOKEN and is the first path segment, so one
 * student's upload cannot be written under another's prefix however the request
 * is shaped. The timestamp means re-uploading never overwrites in place —
 * a half-finished PUT cannot leave someone with a corrupt Aadhaar and no way
 * back to the old one.
 *
 * The extension is derived from the verified content type, never from the
 * filename the browser sent: `passport.jpg.exe` is a filename, not a fact.
 */
export function documentKey(
  studentId: string,
  kind: DocumentKind,
  contentType: string,
  now: number,
): string {
  const extension = EXTENSIONS[contentType] ?? 'bin';
  return `students/${studentId}/${kind}-${now}.${extension}`;
}

/**
 * Whether this file may be stored, and why not if it may not.
 *
 * A photo has to be an image: a PDF headshot is not one, and every screen that
 * later renders it as an <img> would show a broken box instead.
 */
export function checkDocument(
  kind: DocumentKind,
  file: { size: number; mimetype: string } | undefined,
): void {
  if (!file) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to upload', {
      fieldErrors: { file: ['Choose a file to upload'] },
    });
  }

  const accepted = acceptedTypesFor(kind);
  if (!accepted.includes(file.mimetype)) {
    const readable = accepted.map((type) => type.split('/')[1]?.toUpperCase()).join(', ');
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `That file type is not accepted here. Upload one of: ${readable}.`,
      { fieldErrors: { file: ['Not an accepted file type'] } },
    );
  }

  if (file.size > DOCUMENT_MAX_BYTES) {
    const mb = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `That file is larger than ${mb}MB. Take a smaller photo, or compress it.`,
      { fieldErrors: { file: ['That file is too large'] } },
    );
  }

  if (file.size === 0) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That file is empty', {
      fieldErrors: { file: ['That file is empty'] },
    });
  }
}
