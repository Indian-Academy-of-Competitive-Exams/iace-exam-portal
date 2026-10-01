import {
  type LocalizedText,
  type QuestionDetail,
  type QuestionDraft,
  type RichContent,
} from '@iace/contracts';

/** A question's html sits in a stem, a solution and every option, each per language. */
/** Both directions walk it here, because doing it by hand is how one of the three is forgotten. */
type Html = (html: string) => string;

function nodesOf(content: RichContent | undefined, visit: Html): RichContent | undefined {
  return content?.map((node) => ({ ...node, text: visit(node.text) }));
}

/** Every html string the question holds, in no particular order. */
export function mapQuestionHtml(
  detail: Pick<QuestionDetail, 'content' | 'options'>,
  visit: Html,
): string[] {
  const fromContent = Object.values(detail.content).flatMap((field) => [
    ...(field?.stem ?? []),
    ...(field?.solution ?? []),
  ]);
  const fromOptions = detail.options.flatMap((option) =>
    Object.values(option.text ?? {}).flatMap((nodes) => nodes ?? []),
  );

  return [...fromContent, ...fromOptions].map((node) => visit(node.text));
}

const textsOf = (text: LocalizedText | undefined, visit: Html): LocalizedText =>
  Object.fromEntries(Object.entries(text ?? {}).map(([language, html]) => [language, visit(html)]));

/** The same walk over a draft, whose html is a string per language rather than nodes. */
export function rewriteDraftHtml<T extends QuestionDraft>(draft: T, visit: Html): T {
  return {
    ...draft,
    stem: textsOf(draft.stem, visit),
    solution: textsOf(draft.solution, visit),
    options: draft.options.map((option) => ({ ...option, text: textsOf(option.text, visit) })),
  };
}

/** The same walk, rebuilding the question rather than collecting from it. */
export function rewriteQuestionHtml(detail: QuestionDetail, visit: Html): QuestionDetail {
  return {
    ...detail,
    content: Object.fromEntries(
      Object.entries(detail.content).map(([language, field]) => [
        language,
        field && {
          ...field,
          stem: nodesOf(field.stem, visit),
          solution: nodesOf(field.solution, visit),
        },
      ]),
    ),
    options: detail.options.map((option) => ({
      ...option,
      text: Object.fromEntries(
        Object.entries(option.text ?? {}).map(([language, nodes]) => [
          language,
          nodesOf(nodes, visit),
        ]),
      ),
    })),
  } as QuestionDetail;
}

const ESCAPED: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

const DIV_TAG = /<(\/?)div\b[^<>]*>/gi;

/** The characters content escapes on the way in, so a search for them looks for what was stored. */
function escapeForContent(text: string): string {
  return text.replaceAll(/[&<>]/g, (char) => ESCAPED[char] ?? char);
}

/** A cell as the editor would have written it: one paragraph a line, and nothing interpreted. */
export function htmlFromPlainText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';

  return trimmed
    .replaceAll(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeForContent(line)}</p>`)
    .join('');
}

/** Three spaces or more: what an exporter leaves where it lifted an inline picture out of the text. */
const PICTURE_GAP = / {3,}/g;
const GAP_MARK = '\u{E000}';
const MATH_MARK = '\u{E001}';

/** `\( … \)` on one line: a typist's inline formula. Dollars would read "$5 and $10" as one. */
const CELL_MATH = /\\\((.+?)\\\)/g;

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Exactly what the editor writes for an inline formula, so the two are one kind of content. */
const inlineMath = (latex: string): string =>
  `<span data-type="inline-math" data-latex="${latex.replaceAll(/[&<>"]/g, (char) => ATTRIBUTE_ESCAPES[char] ?? char)}"></span>`;

/** A sheet cell as html: its `\( … \)` formulas, and its pictures in the gaps left for them or after the text. */
export function htmlFromCell(text: string, pictureKeys: readonly string[]): string {
  const formulas: string[] = [];
  const marked = text.replaceAll(CELL_MATH, (_match, latex: string) => {
    formulas.push(latex.trim());
    return MATH_MARK;
  });
  let nextFormula = 0;
  return htmlWithPictures(marked, pictureKeys).replaceAll(MATH_MARK, () =>
    inlineMath(formulas[nextFormula++] ?? ''),
  );
}

/** Pictures fill the gaps only when there is exactly one per picture; otherwise a guess, so they follow the text. */
function htmlWithPictures(text: string, keys: readonly string[]): string {
  const tags = keys.map((key) => `<img data-key="${key}" alt="">`);
  if (tags.length === 0) return htmlFromPlainText(text);

  if ((text.match(PICTURE_GAP) ?? []).length === tags.length) {
    let next = 0;
    return htmlFromPlainText(text.replaceAll(PICTURE_GAP, ` ${GAP_MARK}`)).replaceAll(
      GAP_MARK,
      () => tags[next++] ?? '',
    );
  }
  return htmlFromPlainText(text) + tags.map((tag) => `<p>${tag}</p>`).join('');
}

/** Whether ONE div wraps the whole thing — `<div>a</div><p>b</p>` opens on one but is two roots. */
function isSingleDivRoot(html: string): boolean {
  const tags = [...html.matchAll(DIV_TAG)];
  const [opening] = tags;
  if (opening?.index !== 0 || opening[1] === '/') return false;

  let depth = 0;
  for (const tag of tags) {
    depth += tag[1] === '/' ? -1 : 1;
    // Closed before the end, so whatever follows is a second root.
    if (depth === 0) return tag.index + tag[0].length === html.length;
  }
  return false;
}

/** One root per stored field, so a reader styles the block it was given rather than guessing. */
export function asContentHtml(html: string): string {
  const trimmed = html.trim();
  if (trimmed === '') return '';
  return isSingleDivRoot(trimmed) ? trimmed : `<div>${trimmed}</div>`;
}
