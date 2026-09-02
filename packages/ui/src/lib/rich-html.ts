/**
 * The bank's own markup, made safe to render and with its equations drawn.
 * Everything outside the whitelist goes before it reaches the page: an admin
 * writes it today, but the ThinkExam importer will feed the same field, and a
 * paper is read mid-test where nothing can be taken back.
 */
import katex from 'katex';

/** What a question may say. An element outside this keeps its text and loses its tag. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  P: [],
  BR: [],
  STRONG: [],
  EM: [],
  U: [],
  SUP: [],
  SUB: [],
  UL: [],
  OL: [],
  LI: [],
  TABLE: [],
  THEAD: [],
  TBODY: [],
  TR: [],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
  IMG: ['src', 'alt', 'width'],
  SPAN: [],
};

/** Unwrapping these would set their contents loose as markup, so they go whole. */
const DROPPED = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'FRAME',
  'FRAMESET',
  'OBJECT',
  'EMBED',
  'APPLET',
  'SVG',
  'MATH',
  'LINK',
  'META',
  'BASE',
  'FORM',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'BUTTON',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'XMP',
]);

const MATH_CLASS = 'math-render';
const SCROLL_CLASS = 'rich-scroll';

/** Anything that is not a fetchable image — `javascript:` above all — loses the tag with it. */
function drawable(src: string): boolean {
  try {
    const url = new URL(src, 'https://iace.invalid/');
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** KaTeX's own output, from LaTeX the editor stored: red beats blank when it will not parse. */
function mathNode(document: Document, latex: string, display: boolean): Element {
  const host = document.createElement(display ? 'div' : 'span');
  host.className = display ? `${MATH_CLASS} ${MATH_CLASS}--display` : MATH_CLASS;
  try {
    host.innerHTML = katex.renderToString(latex, { throwOnError: false, displayMode: display });
  } catch {
    host.textContent = latex;
  }
  return host;
}

function keepAttributes(element: Element, allowed: readonly string[]): void {
  for (const name of element.getAttributeNames()) {
    if (!allowed.includes(name)) element.removeAttribute(name);
  }
}

const undrawable = (element: Element): boolean =>
  element.tagName === 'IMG' && !drawable(element.getAttribute('src') ?? '');

function clean(element: Element, document: Document): void {
  const authored = element instanceof HTMLElement ? element.dataset : undefined;
  if (authored?.latex !== undefined) {
    const display = (authored.type ?? '').includes('block');
    element.replaceWith(mathNode(document, authored.latex, display));
    return;
  }
  if (DROPPED.has(element.tagName)) {
    element.remove();
    return;
  }

  // A snapshot: cleaning a child replaces or removes it, and `children` is live.
  const children = [...element.children];
  for (const child of children) clean(child, document);

  const allowed = ALLOWED[element.tagName];
  if (!allowed) element.replaceWith(...element.childNodes);
  else if (undrawable(element)) element.remove();
  else keepAttributes(element, allowed);
}

/** A table wider than the panel scrolls in its own box; the exam screen itself never scrolls sideways. */
function boxTables(body: HTMLElement, document: Document): void {
  for (const table of body.querySelectorAll('table')) {
    const box = document.createElement('div');
    box.className = SCROLL_CLASS;
    table.replaceWith(box);
    box.append(table);
  }
}

/** Safe to hand to `dangerouslySetInnerHTML`, and only ever produced here. */
export function richHtml(html: string): string {
  if (html === '') return '';

  const document = new DOMParser().parseFromString(html, 'text/html');
  const top = [...document.body.children];
  for (const child of top) clean(child, document);
  boxTables(document.body, document);
  return document.body.innerHTML;
}

/** Whether KaTeX will render this, and why not — strict, unlike the drawing above. */
export function mathErrorIn(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'error' });
    return null;
  } catch (error) {
    return (error as Error).message.replace('KaTeX parse error: ', '');
  }
}
