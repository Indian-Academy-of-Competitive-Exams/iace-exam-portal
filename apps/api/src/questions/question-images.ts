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

const IMG_TAG = /<img\b[^>]*>/gi;
const DATA_KEY = /\bdata-key="([^"]+)"/i;
// A single `\s`, never `\s+`: it backtracks, and `\s?` would match the src inside data-src.
const SRC_ATTR = /\ssrc="[^"]*"/gi;
const DATA_URI_SRC = /\ssrc="data:[^"]*"/gi;

/** Every image key quoted by a piece of content, so a page of them signs in one pass. */
export function imageKeysIn(html: string): string[] {
  return (html.match(IMG_TAG) ?? []).flatMap((tag) => DATA_KEY.exec(tag)?.[1] ?? []);
}

/** Strips the transient src before storing: a signed one would rot, and a `data:` one is bytes. */
export function stripImageSrc(html: string): string {
  return html
    .replace(IMG_TAG, (tag) => (DATA_KEY.test(tag) ? tag.replace(SRC_ATTR, '') : tag))
    .replace(IMG_TAG, (tag) => tag.replace(DATA_URI_SRC, ''));
}

/** Puts a freshly signed src back for the reader. Content on disk still holds only the key. */
export function applyImageUrls(html: string, urls: ReadonlyMap<string, string>): string {
  return html.replace(IMG_TAG, (tag) => {
    const key = DATA_KEY.exec(tag)?.[1];
    const url = key ? urls.get(key) : undefined;
    if (!url) return tag;

    // Sliced rather than matched: every tag here ends in `>`, so a regex only adds backtracking.
    const bare = tag.replace(SRC_ATTR, '');
    const open = bare.endsWith('/>') ? bare.slice(0, -2) : bare.slice(0, -1);
    return `${open.trimEnd()} src="${url}">`;
  });
}
