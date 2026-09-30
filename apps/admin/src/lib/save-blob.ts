import { useMutation } from '@tanstack/react-query';

/**
 * Hands a fetched file to the browser. Not an <a href>: the endpoint is authenticated,
 * and a bare link would save a 401 body under an .xlsx name.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

/** Every import screen's template button: fetch the sheet, hand it over under its own name. */
export function useTemplateDownload(fetch: () => Promise<Blob>, filename: string) {
  return useMutation({
    mutationFn: fetch,
    onSuccess: (blob) => saveBlob(blob, filename),
  });
}
