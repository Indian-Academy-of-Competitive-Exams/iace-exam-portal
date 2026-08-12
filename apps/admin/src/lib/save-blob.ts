/**
 * Hands a downloaded file to the browser.
 *
 * A generated file cannot be a plain <a href>: the endpoint is authenticated,
 * and a bare link sends no Authorization header — it would save a 401 body
 * under an .xlsx name, which opens as a corrupt file rather than as an error.
 * So the client fetches it and this puts the result where the browser expects.
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
