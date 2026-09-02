/** The smallest byte sequence each format is still recognisable from, built by hand so no fixture files are needed. */

export function pngBytes(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

export function gifBytes(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(10);
  buffer.write('GIF89a', 0, 'latin1');
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

/** An APP0 segment first, so the reader has to walk past something to reach the frame header. */
export function jpegBytes(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffd8, 0);
  app0.writeUInt16BE(0xffe0, 2);
  app0.writeUInt16BE(16, 4);

  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(9, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);

  return Buffer.concat([app0, frame]);
}

export type WebpChunk = 'VP8 ' | 'VP8L' | 'VP8X';

export function webpBytes(width: number, height: number, chunk: WebpChunk = 'VP8L'): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WEBP', 8, 'latin1');
  buffer.write(chunk, 12, 'latin1');

  if (chunk === 'VP8 ') {
    Buffer.from([0x9d, 0x01, 0x2a]).copy(buffer, 23);
    buffer.writeUInt16LE(width, 26);
    buffer.writeUInt16LE(height, 28);
  } else if (chunk === 'VP8L') {
    buffer.writeUInt8(0x2f, 20);
    buffer.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  } else {
    buffer.writeUIntLE(width - 1, 24, 3);
    buffer.writeUIntLE(height - 1, 27, 3);
  }

  return buffer;
}
