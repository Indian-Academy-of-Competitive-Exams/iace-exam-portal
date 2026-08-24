import { type QuestionDetail, type RichContent } from '@iace/contracts';

/** A question's html sits in a stem, a solution and every option, each per language. */
/** Both directions walk it here, because doing it by hand is how one of the three is forgotten. */
type Html = (html: string) => string;

function nodesOf(content: RichContent | undefined, visit: Html): RichContent | undefined {
  return content?.map((node) => ({ ...node, text: visit(node.text) }));
}

/** Every html string the question holds, in no particular order. */
export function mapQuestionHtml(detail: QuestionDetail, visit: Html): string[] {
  const fromContent = Object.values(detail.content).flatMap((field) => [
    ...(field?.stem ?? []),
    ...(field?.solution ?? []),
  ]);
  const fromOptions = detail.options.flatMap((option) =>
    Object.values(option.text ?? {}).flatMap((nodes) => nodes ?? []),
  );

  return [...fromContent, ...fromOptions].map((node) => visit(node.text));
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

const ESCAPED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

const DIV_TAG = /<(\/?)div\b[^<>]*>/gi;

/** The characters content escapes on the way in, so a search for them looks for what was stored. */
export function escapeForContent(text: string): string {
  return text.replaceAll(/[&<>]/g, (char) => ESCAPED[char]!);
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

/** Whether ONE div wraps the whole thing — `<div>a</div><p>b</p>` opens on one but is two roots. */
function isSingleDivRoot(html: string): boolean {
  const tags = [...html.matchAll(DIV_TAG)];
  if (tags.length === 0 || tags[0]!.index !== 0 || tags[0]![1] === '/') return false;

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
