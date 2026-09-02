import { randomUUID } from 'node:crypto';
import {
  AppException,
  ErrorCodes,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
  QUESTION_IMAGE_MAX_PIXELS,
} from '@iace/contracts';
import { sniffImage, type SniffedImage } from './image-bytes';

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

export interface UploadedImage {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

/** The bytes, plus what they turned out to be — the one thing that reaches storage. */
export interface CheckedImage extends SniffedImage {
  buffer: Buffer;
}

const refuse = (message: string, field: string): never => {
  throw new AppException(ErrorCodes.VALIDATION_ERROR, message, { fieldErrors: { file: [field] } });
};

/** What may be stored, and why not if it may not. The BYTES decide the type — the browser only guessed. */
export function checkQuestionImage(file: UploadedImage | undefined): CheckedImage {
  if (!file) return refuse('Choose an image to upload', 'Choose an image to upload');
  if (file.size === 0) return refuse('That file is empty', 'That file is empty');

  if (file.size > QUESTION_IMAGE_MAX_BYTES) {
    const mb = QUESTION_IMAGE_MAX_BYTES / 1024 / 1024;
    return refuse(
      `That image is larger than ${mb}MB. Export it smaller, or save it as a PNG.`,
      'That image is too large',
    );
  }

  const image = sniffImage(file.buffer);
  if (!image) {
    const readable = QUESTION_IMAGE_ACCEPTED_TYPES.map((type) =>
      type.split('/')[1]?.toUpperCase(),
    ).join(', ');
    return refuse(
      `That file is not an image, whatever it is named. Upload one of: ${readable}.`,
      'Not an accepted file type',
    );
  }

  const megapixels = QUESTION_IMAGE_MAX_PIXELS / 1_000_000;
  if (image.width * image.height > QUESTION_IMAGE_MAX_PIXELS) {
    return refuse(
      `That image is ${image.width}×${image.height}. Scale it under ${megapixels} megapixels — a figure never needs that many.`,
      'That image is too large to draw',
    );
  }

  return { ...image, buffer: file.buffer };
}

export { imageKeysIn } from '@iace/contracts';

const IMG_TAG = /<img\b[^>]*>/gi;
const DATA_KEY = /\bdata-key="([^"]+)"/i;
// A single `\s`, never `\s+`: it backtracks, and `\s?` would match the src inside data-src.
const SRC_ATTR = /\ssrc="[^"]*"/gi;
const DATA_URI_SRC = /\ssrc="data:[^"]*"/gi;

/** Our figures are addressed by key, so an `<img>` without one names a file we cannot serve. */
export function withoutForeignImages(html: string): string {
  return html.replace(IMG_TAG, (tag) => (DATA_KEY.test(tag) ? tag : ''));
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
