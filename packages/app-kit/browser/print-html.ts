let frame: HTMLIFrameElement | undefined;

/** Prints a standalone document from a hidden frame, so the app's shell and its scrollports never reach the paper. */
export function printHtml(html: string): void {
  frame?.remove();
  const next = document.createElement('iframe');
  next.setAttribute('aria-hidden', 'true');
  next.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  next.srcdoc = html;
  // `load` waits for images and stylesheets; a face named by a stylesheet is fetched only once it is used.
  next.onload = () => {
    const ready = next.contentDocument?.fonts.ready ?? Promise.resolve();
    void ready.then(() => next.contentWindow?.print());
  };
  document.body.append(next);
  frame = next;
}

const PAGE = '@page { size: A4; margin: 14mm; } body { margin: 0; background: white; }';

/** Prints one element as its own page, under the app's own stylesheets: rich content and equations draw as they do on screen. */
export function printElement(element: HTMLElement, title: string): void {
  const sheets = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((sheet) => sheet.outerHTML)
    .join('');
  const heading = document.createElement('title');
  heading.textContent = title;
  // A relative stylesheet link has to resolve from the frame, which has no address of its own.
  const base = `<base href="${document.baseURI}">`;
  printHtml(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">${base}${heading.outerHTML}${sheets}<style>${PAGE}</style></head><body>${element.outerHTML}</body></html>`,
  );
}
