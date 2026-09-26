import { createHash, randomUUID } from 'node:crypto';
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

/** A figure's key never points at other bytes, so a browser may keep it for good. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** By content: one picture imported twice is one object, and a re-import still matches its own question. */
export function importedImageKey(image: CheckedImage): string {
  const digest = createHash('sha256').update(image.buffer).digest('hex').slice(0, 32);
  return `questions/images/${digest}.${EXTENSIONS[image.contentType] ?? 'bin'}`;
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

/** Why a figure may not be stored: the upload refuses with it, an import reports it against the row. */
export interface ImageProblem {
  problem: string;
  field: string;
}

/** What may be stored, and why not if it may not. The BYTES decide the type — the browser only guessed. */
export function checkQuestionImage(file: UploadedImage | undefined): CheckedImage {
  if (!file) return refuse('Choose an image to upload', 'Choose an image to upload');
  if (file.size === 0) return refuse('That file is empty', 'That file is empty');

  const judged = judgeQuestionImage(file.buffer, file.size);
  return 'problem' in judged ? refuse(judged.problem, judged.field) : judged;
}

export function judgeQuestionImage(
  buffer: Buffer,
  size = buffer.length,
): CheckedImage | ImageProblem {
  if (size > QUESTION_IMAGE_MAX_BYTES) {
    const mb = QUESTION_IMAGE_MAX_BYTES / 1024 / 1024;
    return {
      problem: `That image is larger than ${mb}MB. Export it smaller, or save it as a PNG.`,
      field: 'That image is too large',
    };
  }

  const image = sniffImage(buffer);
  if (!image) {
    const readable = QUESTION_IMAGE_ACCEPTED_TYPES.map((type) =>
      type.split('/')[1]?.toUpperCase(),
    ).join(', ');
    return {
      problem: `That file is not an image, whatever it is named. Upload one of: ${readable}.`,
      field: 'Not an accepted file type',
    };
  }

  const megapixels = QUESTION_IMAGE_MAX_PIXELS / 1_000_000;
  if (image.width * image.height > QUESTION_IMAGE_MAX_PIXELS) {
    return {
      problem: `That image is ${image.width}×${image.height}. Scale it under ${megapixels} megapixels. A figure never needs that many.`,
      field: 'That image is too large to draw',
    };
  }

  return { ...image, buffer };
}

export { imageKeysIn } from '@iace/contracts';

const IMG_TAG = /<img\b[^>]*>/gi;
const IMG_OPEN = '<img';
const DATA_KEY = /\bdata-key="([^"]+)"/i;
// A single `\s`, never `\s+`: it backtracks, and `\s?` would match the src inside data-src.
const SRC_ATTR = /\ssrc="[^"]*"/gi;
const DATA_URI_SRC = /\ssrc="data:[^"]*"/gi;

/** Our figures are addressed by key, so an `<img>` without one names a file we cannot serve. */
export function withoutForeignImages(html: string): string {
  return html.replace(IMG_TAG, (tag) => (DATA_KEY.test(tag) ? tag : ''));
}

/** Strips the transient src before storing: the key is the record, and a `data:` one is bytes. */
export function stripImageSrc(html: string): string {
  return html
    .replace(IMG_TAG, (tag) => (DATA_KEY.test(tag) ? tag.replace(SRC_ATTR, '') : tag))
    .replace(IMG_TAG, (tag) => tag.replace(DATA_URI_SRC, ''));
}

/** Serves only a src it just built: content stored before the write guard may point anywhere. */
export function applyImageUrls(html: string, urls: ReadonlyMap<string, string>): string {
  return withoutForeignImages(html).replace(IMG_TAG, (tag) => {
    const bare = tag.replace(SRC_ATTR, '');
    const key = DATA_KEY.exec(tag)?.[1];
    const url = key ? urls.get(key) : undefined;
    // First, because a parser keeps the first of two srcs, however the other one was quoted.
    return url ? `${IMG_OPEN} src="${url}"${bare.slice(IMG_OPEN.length)}` : bare;
  });
}
