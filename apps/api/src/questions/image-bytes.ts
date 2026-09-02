/**
 * What a file IS, read from its leading bytes. A content type arrives from the
 * browser, which took it from the extension, which the person uploading chose —
 * so it is a hint about the name, never a fact about the bytes.
 */
import { QUESTION_IMAGE_ACCEPTED_TYPES } from '@iace/contracts';

export interface SniffedImage {
  contentType: (typeof QUESTION_IMAGE_ACCEPTED_TYPES)[number];
  width: number;
  height: number;
}

type Reader = (buffer: Buffer) => SniffedImage | null;

const startsWith = (buffer: Buffer, bytes: readonly number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const ascii = (buffer: Buffer, at: number, length: number): string =>
  buffer.subarray(at, at + length).toString('latin1');

/** `IHDR` is fixed as the first chunk, so the size is always at the same two offsets. */
const png: Reader = (buffer) => {
  if (!startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || buffer.length < 24) {
    return null;
  }
  return {
    contentType: 'image/png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

const gif: Reader = (buffer) => {
  if (buffer.length < 10 || !['GIF87a', 'GIF89a'].includes(ascii(buffer, 0, 6))) return null;
  return {
    contentType: 'image/gif',
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
};

/** Three encodings under one RIFF wrapper, each keeping its size somewhere else. */
const webp: Reader = (buffer) => {
  if (buffer.length < 30 || ascii(buffer, 0, 4) !== 'RIFF' || ascii(buffer, 8, 4) !== 'WEBP') {
    return null;
  }

  const size = webpSize(ascii(buffer, 12, 4), buffer);
  return size && { contentType: 'image/webp', ...size };
};

function webpSize(chunk: string, buffer: Buffer): { width: number; height: number } | null {
  if (chunk === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const packed = buffer.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/** The size lives in a frame header somewhere after the metadata, so the segments are walked. */
const jpeg: Reader = (buffer) => {
  if (!startsWith(buffer, [0xff, 0xd8, 0xff])) return null;

  let at = 2;
  while (at + 9 < buffer.length) {
    if (buffer[at] !== 0xff) return null;
    const marker = buffer[at + 1]!;
    if (isFrameHeader(marker)) {
      return {
        contentType: 'image/jpeg',
        width: buffer.readUInt16BE(at + 7),
        height: buffer.readUInt16BE(at + 5),
      };
    }
    at += 2 + buffer.readUInt16BE(at + 2);
  }
  return null;
};

/** SOF0-SOF15, minus the three markers that share the range and are not frames. */
const isFrameHeader = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

const READERS: readonly Reader[] = [png, jpeg, gif, webp];

/** Null for anything that is not one of the formats a question may carry. */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  for (const read of READERS) {
    const image = read(buffer);
    if (image && image.width > 0 && image.height > 0) return image;
  }
  return null;
}
