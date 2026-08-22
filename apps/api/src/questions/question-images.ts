import { randomUUID } from 'node:crypto';
import {
  AppException,
  ErrorCodes,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
} from '@iace/contracts';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** A uuid, not a filename: two authors uploading "diagram1.png" must not land on one object. */
/** Unscoped, because the image is uploaded before the question it belongs to has an id. */
export function questionImageKey(contentType: string): string {
  return `questions/images/${randomUUID()}.${EXTENSIONS[contentType] ?? 'bin'}`;
}

/** Whether this file may be stored, and why not if it may not. */
export function checkQuestionImage(
  file: { size: number; mimetype: string } | undefined,
): asserts file is { size: number; mimetype: string } {
  if (!file) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Choose an image to upload', {
      fieldErrors: { file: ['Choose an image to upload'] },
    });
  }

  const accepted: readonly string[] = QUESTION_IMAGE_ACCEPTED_TYPES;
  if (!accepted.includes(file.mimetype)) {
    const readable = accepted.map((type) => type.split('/')[1]?.toUpperCase()).join(', ');
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `That file type is not accepted here. Upload one of: ${readable}.`,
      { fieldErrors: { file: ['Not an accepted file type'] } },
    );
  }

  if (file.size > QUESTION_IMAGE_MAX_BYTES) {
    const mb = QUESTION_IMAGE_MAX_BYTES / 1024 / 1024;
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      `That image is larger than ${mb}MB. Export it smaller, or save it as a PNG.`,
      { fieldErrors: { file: ['That image is too large'] } },
    );
  }

  if (file.size === 0) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That file is empty', {
      fieldErrors: { file: ['That file is empty'] },
    });
  }
}
