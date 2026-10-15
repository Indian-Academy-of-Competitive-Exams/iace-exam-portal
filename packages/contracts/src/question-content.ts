import { z } from 'zod';
import { type LanguageCode } from './exams';

/** The languages a question may be authored in — the KEYS inside a version's `content` and each option's `text`, so a value here is a column in the import sheet and a tab in the form. */
export const SUPPORTED_LANGUAGES = {
  EN: 'en',
  HI: 'hi',
  TE: 'te',
} as const;
export const languageSchema = z.enum(SUPPORTED_LANGUAGES);
export type QuestionLanguage = z.infer<typeof languageSchema>;

/** `LanguageCode` (EN) is what a row stores, `QuestionLanguage` (en) keys the content JSON. */
const CONTENT_LANGUAGE: Readonly<Record<LanguageCode, QuestionLanguage>> = {
  EN: SUPPORTED_LANGUAGES.EN,
  HI: SUPPORTED_LANGUAGES.HI,
  TE: SUPPORTED_LANGUAGES.TE,
};

export const contentLanguageOf = (code: LanguageCode): QuestionLanguage => CONTENT_LANGUAGE[code];

/** English is mandatory on every question: it is what the bank is searched and deduped by. */
export const DEFAULT_LANGUAGE: QuestionLanguage = SUPPORTED_LANGUAGES.EN;

/** Authoring order — the tab order in the form and the column order in the sheet. */
export const LANGUAGE_ORDER = [
  SUPPORTED_LANGUAGES.EN,
  SUPPORTED_LANGUAGES.HI,
  SUPPORTED_LANGUAGES.TE,
] as const;

export const LANGUAGE_LABELS: Record<QuestionLanguage, string> = {
  [SUPPORTED_LANGUAGES.EN]: 'English',
  [SUPPORTED_LANGUAGES.HI]: 'Hindi',
  [SUPPORTED_LANGUAGES.TE]: 'Telugu',
};

/** A field in each language the author filled in; `partialRecord`, not `record`, since English is required by `validateQuestion` per field, and an unknown key is refused here. */
export const localizedTextSchema = z.partialRecord(languageSchema, z.string());
export type LocalizedText = z.infer<typeof localizedTextSchema>;

// ============================================================================
// Content. Stored as nodes rather than a string so an image or an equation is a
// node type later, not a parser that has to guess what a string meant.
// ============================================================================

const CONTENT_NODE_TYPE = {
  TEXT: 'TEXT',
} as const;

const contentNodeSchema = z.object({
  type: z.literal(CONTENT_NODE_TYPE.TEXT),
  text: z.string(),
});

/** One field — a stem, a solution, an option — in one language. */
const richContentSchema = z.array(contentNodeSchema);
export type RichContent = z.infer<typeof richContentSchema>;

/** The text of a field, for searching, hashing and a one-line preview. */
export function plainTextOf(content: RichContent | undefined): string {
  if (!content) return '';
  return content
    .map((node) => node.text)
    .join(' ')
    .trim();
}

// `[^<>]`, not `[^>]`: a run of `<` makes the looser one rescan from every one of them.
const ANY_TAG = /<[^<>]*>/g;
const LATEX_ATTR = /\sdata-latex="([^"]*)"/i;
const IMAGE_TAG = /^<img\b/i;
const BLOCK_END = /^<\/(?:p|li|div|tr|h[1-6]|blockquote|td|th)>$/i;
const ENTITY: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&amp;': '&',
};

/** One pass over the tags, so nothing has two negated classes to backtrack between. */
function textFor(tag: string): string {
  const latex = LATEX_ATTR.exec(tag)?.[1];
  if (latex) return ` ${latex} `;
  if (IMAGE_TAG.test(tag)) return ' [image] ';
  return BLOCK_END.test(tag) ? ' ' : '';
}

/** A reader wants the question, not its markup: LaTeX survives, an image becomes a word. */
export function previewTextOf(html: string): string {
  return html
    .replaceAll(ANY_TAG, textFor)
    .replaceAll(/&[a-z#0-9]+;/gi, (entity) => ENTITY[entity.toLowerCase()] ?? entity)
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** Whether html says anything at all — the `<p></p>` an emptied editor box posts does not. */
export function hasText(html: string | undefined): boolean {
  return html !== undefined && previewTextOf(html) !== '';
}

const IMG_TAG = /<img\b[^>]*>/gi;
const DATA_KEY = /\bdata-key="([^"]+)"/i;

/** The S3 key of every image in a piece of content — what makes two figures the same figure. */
export function imageKeysIn(html: string): string[] {
  return (html.match(IMG_TAG) ?? []).flatMap((tag) => DATA_KEY.exec(tag)?.[1] ?? []);
}

/** Editor output: `<span data-type="inline-math" data-latex="\\frac{a}{b}">`. */
const MATH_LATEX = /data-latex="([^"]*)"/gi;

/** Attribute values arrive html-escaped, and KaTeX must parse the LaTeX, not the escaping. */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll('&amp;', '&');
}

/** Every formula a piece of content carries, in the order they appear. */
export function latexIn(html: string): string[] {
  return [...html.matchAll(MATH_LATEX)].map((match) => unescapeAttribute(match[1] ?? ''));
}

const questionContentSchema = z.object({
  stem: richContentSchema,
  /** What the question is asked ABOUT: a comprehension passage, a data set, a set of directions. */
  passage: richContentSchema.optional(),
  solution: richContentSchema.optional(),
});

/** `Question.content` on the wire: one entry per language the author filled in. */
export const localizedContentSchema = z.partialRecord(languageSchema, questionContentSchema);
export type LocalizedContent = z.infer<typeof localizedContentSchema>;

/** An option's `text`, as it sits inside a question version. */
export const localizedRichSchema = z.partialRecord(languageSchema, richContentSchema);
export type LocalizedRich = z.infer<typeof localizedRichSchema>;

// ============================================================================
// Question images
// ============================================================================

/** The multipart field the image arrives in. */
export const QUESTION_IMAGE_FILE_FIELD = 'file';

/** A diagram, not a photograph — 2MB is generous for the pictorial-reasoning art this holds. */
export const QUESTION_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** A diagram nobody scaled decodes to hundreds of megabytes in a candidate's browser mid-test. */
export const QUESTION_IMAGE_MAX_PIXELS = 12_000_000;

/** SVG is absent on purpose: it is a script container, and this renders in the student's browser. */
export const QUESTION_IMAGE_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

/** Content stores the KEY, never the url: a signed url would rot inside every question quoting it. */
export const questionImageSchema = z.object({
  key: z.string(),
  url: z.string(),
});
export type QuestionImage = z.infer<typeof questionImageSchema>;
