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
