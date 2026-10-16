import { AppException, ErrorCodes, SUPPORT_ATTACHMENT_MAX_BYTES } from '@iace/contracts';
import { sniffImage } from '../questions';

export interface SupportUpload {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

export const supportKeyPrefix = (ticketId: string) => `support/t/${ticketId}/`;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const refuse = (message: string, field = 'file'): never => {
  throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
    fieldErrors: { [field]: [message] },
  });
};

/** What the bytes are, never the claimed mimetype. */
export function checkSupportImage(file: SupportUpload | undefined): {
  contentType: string;
  extension: string;
  buffer: Buffer;
} {
  if (!file) return refuse('Choose a file to upload');
  if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) return refuse('That image is larger than 5MB');
  if (file.size === 0) return refuse('That file is empty');
  const image = sniffImage(file.buffer);
  if (!image) return refuse('Attach a JPEG, PNG, WEBP or GIF image');
  return {
    contentType: image.contentType,
    extension: EXTENSIONS[image.contentType] ?? 'bin',
    buffer: file.buffer,
  };
}

export function assertKeyUnder(key: string | undefined, prefix: string): void {
  if (key === undefined || key.startsWith(prefix)) return;
  refuse('That image is not yours to attach', 'attachmentKey');
}
