import {
  AppException,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_BYTES,
  ErrorCodes,
  acceptedTypesFor,
  type DocumentKind,
} from '@iace/contracts';
import { type ProfileDocumentColumn } from '../students';

/** The rules for a student's uploaded photo and identity documents. */

/** Which profile column each kind writes to. The client never chooses this. */
const COLUMN_FOR: Record<DocumentKind, ProfileDocumentColumn> = {
  [DOCUMENT_KINDS.PHOTO]: 'photoUrl',
  [DOCUMENT_KINDS.AADHAAR]: 'aadhaarUrl',
  [DOCUMENT_KINDS.PAN]: 'panUrl',
};

export function columnFor(kind: DocumentKind): ProfileDocumentColumn {
  return COLUMN_FOR[kind];
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Where an upload is stored. */
export function documentKey(
  studentId: string,
  kind: DocumentKind,
  contentType: string,
  now: number,
): string {
  const extension = EXTENSIONS[contentType] ?? 'bin';
  return `students/${studentId}/${kind}-${now}.${extension}`;
}

/** Whether this file may be stored, and why not if it may not. */
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
