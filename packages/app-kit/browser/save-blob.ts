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
