/**
 * Re-encodes a picked image to WebP before it is uploaded. The diagrams this platform carries —
 * charts, pie slices, circles, equations — arrive as screenshots of a few hundred kilobytes and
 * leave as a few tens, which is what every candidate on mobile data downloads mid-paper.
 */

/** Below this an encode wins nothing, and a crisp small PNG is worth more than a smaller file. */
const WORTH_ENCODING_BYTES = 200 * 1024;

/** Wider than any question panel draws, so nothing visible is lost by capping here. */
const MAX_WIDTH = 1600;

/** Line art needs its edges: WebP below this smears the thin strokes a graph is made of. */
const QUALITY = 0.92;

const WEBP = 'image/webp';

/** An animated GIF has frames a canvas would flatten to the first one. */
const REENCODABLE = new Set(['image/jpeg', 'image/png', WEBP]);

export function worthEncoding(file: { type: string; size: number }): boolean {
  return REENCODABLE.has(file.type) && file.size > WORTH_ENCODING_BYTES;
}

/** Never upscales: a diagram narrower than the cap is drawn at its own size. */
export function drawnSize(
  width: number,
  height: number,
  maxWidth = MAX_WIDTH,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

export const webpName = (name: string): string => `${name.replace(/\.[^.]+$/, '')}.webp`;

async function encoded(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = drawnSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, WEBP, QUALITY));
  if (!blob || blob.type !== WEBP || blob.size >= file.size) return null;
  return new File([blob], webpName(file.name), { type: WEBP, lastModified: file.lastModified });
}

/** The original whenever the encode would not help, or the browser refused it. */
export async function shrunkForUpload(file: File): Promise<File> {
  if (!worthEncoding(file)) return file;
  try {
    return (await encoded(file)) ?? file;
  } catch {
    return file;
  }
}
