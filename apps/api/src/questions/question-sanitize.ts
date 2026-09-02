/**
 * The gate authored markup passes on the way in — the editor's save and the
 * importer's commit both reach it, because both build their content here.
 * `RichContent` allows the same tags again at render, on its way to the DOM.
 */
import { sanitize } from 'isomorphic-dompurify';
import { withoutForeignImages } from './question-images';

/** What a question may say. Anything else keeps its words and loses its tag. */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  'sup',
  'sub',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'img',
  'span',
  // A block formula is a div, so one has to survive the way in.
  'div',
];

/** `data-latex`, `data-type` and `data-key` are data attributes, which DOMPurify keeps by default. */
const ALLOWED_ATTR = ['colspan', 'rowspan', 'src', 'alt', 'width'];

/** Authored html with everything that can run gone: scripts, handlers, and foreign schemes. */
export function sanitizeContentHtml(html: string): string {
  return withoutForeignImages(
    sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: true }),
  );
}
