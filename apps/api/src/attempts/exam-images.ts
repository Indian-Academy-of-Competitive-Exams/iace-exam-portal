/** Content on disk holds only the image KEY, so whatever renders it signs its own, long enough. */
import { StorageService } from '../storage/storage.service';
import { imageKeysIn } from '../questions';

/** Longer than the longest sitting: an image that expires mid-exam is a question nobody can read. */
const EXAM_IMAGE_URL_TTL_SEC = 6 * 60 * 60;

export async function imageUrlsIn(
  storage: StorageService,
  html: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const keys = new Set(html.flatMap(imageKeysIn));
  if (keys.size === 0) return new Map();

  return new Map(
    await Promise.all(
      [...keys].map(
        async (key) => [key, await storage.createDownloadUrl(key, EXAM_IMAGE_URL_TTL_SEC)] as const,
      ),
    ),
  );
}
