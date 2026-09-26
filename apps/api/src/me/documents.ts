import {
  AppException,
  DOCUMENT_KINDS,
  ACCEPTED_TYPES_FOR,
  DOCUMENT_MAX_BYTES,
  ErrorCodes,
  type DocumentKind,
} from '@iace/contracts';
import { type ProfileDocumentColumn } from '../students';
import { sniffImage } from '../questions';

/** Which profile column each kind writes to. The client never chooses this. */
const COLUMN_FOR: Record<DocumentKind, ProfileDocumentColumn> = {
  [DOCUMENT_KINDS.PHOTO]: 'photoUrl',
  [DOCUMENT_KINDS.TENTH_MARKSHEET]: 'tenthMarksheetUrl',
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

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

/** `sniffImage` only knows pictures; a marksheet may also be the one non-image type accepted here. */
const isPdf = (buffer: Buffer): boolean => buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);

/** What the bytes actually are, restricted to what this kind accepts — the browser's mimetype is never asked. */
function sniffedType(buffer: Buffer, accepted: readonly string[]): string | null {
  const image = sniffImage(buffer)?.contentType;
  if (image && accepted.includes(image)) return image;
  if (accepted.includes('application/pdf') && isPdf(buffer)) return 'application/pdf';
  return null;
}

/** Whether this file may be stored, and what it actually is if it may — the BYTES decide, never the claimed mimetype. */
export function checkDocument(
  file: { buffer: Buffer; size: number; mimetype: string } | undefined,
  kind: DocumentKind,
): string {
  if (!file) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose a file to upload', {
      fieldErrors: { file: ['Choose a file to upload'] },
    });
  }

  if (file.size > DOCUMENT_MAX_BYTES) {
    const mb = Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024);
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `That file is larger than ${mb}MB. Compress it, or scan it at a lower quality.`,
      { fieldErrors: { file: ['That file is too large'] } },
    );
  }

  if (file.size === 0) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That file is empty', {
      fieldErrors: { file: ['That file is empty'] },
    });
  }

  const accepted = ACCEPTED_TYPES_FOR[kind];
  const contentType = sniffedType(file.buffer, accepted);
  if (!contentType) {
    const readable = accepted.map((type) => type.split('/')[1]?.toUpperCase()).join(', ');
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `That file type is not accepted here. Upload one of: ${readable}.`,
      { fieldErrors: { file: ['Not an accepted file type'] } },
    );
  }

  return contentType;
}
