/** Content on disk holds only the image KEY, so whatever renders it builds the url it serves. */
import { StorageService } from '../storage/storage.service';
import { imageKeysIn } from '../questions';

export function imageUrlsIn(
  storage: StorageService,
  html: readonly string[],
): ReadonlyMap<string, string> {
  const keys = new Set(html.flatMap(imageKeysIn));
  return new Map([...keys].map((key) => [key, storage.publicUrl(key)]));
}
