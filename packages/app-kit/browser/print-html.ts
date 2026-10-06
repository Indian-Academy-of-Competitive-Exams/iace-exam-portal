let frame: HTMLIFrameElement | undefined;

/** Prints a standalone document from a hidden frame, so the app's shell and its scrollports never reach the paper. */
export function printHtml(html: string): void {
  frame?.remove();
  const next = document.createElement('iframe');
  next.setAttribute('aria-hidden', 'true');
  next.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  next.srcdoc = html;
  next.onload = () => next.contentWindow?.print();
  document.body.append(next);
  frame = next;
}
