/**
 * The questions list as a workbook in the import's own columns, so an unchanged row re-plans as a
 * duplicate. A cell is plain text: an equation is written as its LaTeX and an image as its storage
 * key, exactly as the stem hash folds them, and Rich content names what a sheet cannot carry back.
 */
import {
  LANGUAGE_ORDER,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_SHEETS,
  QUESTION_STATUSES,
  TAG_SEPARATOR,
  imageKeysIn,
  latexIn,
  plainTextOf,
  previewTextOf,
  type QuestionDetail,
  type QuestionImportColumnKey,
  type QuestionLanguage,
  type QuestionStatus,
  type RichContent,
} from '@iace/contracts';
import {
  EXPORT_DATE_FORMATS,
  exportInstant,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { mapQuestionHtml } from './question-content';

/** Not "Question code": the importer would normalise that to its own `question_code` column. */
export const CODE_HEADER = 'Existing question code';

export const RICH_CONTENT = { IMAGE: 'Image', EQUATION: 'Equation' } as const;

/** Only what the columns read, so a 50,000-row export never loads a page's counts or assignment. */
export type ExportedQuestion = Pick<
  QuestionDetail,
  'questionCode' | 'type' | 'difficulty' | 'status' | 'tags' | 'content' | 'options' | 'answerKey'
> & { subject: string; topic: string | null; author: string | null; createdAt: Date };

export interface AuthoringCount {
  author: string;
  byStatus: Record<QuestionStatus, number>;
}

const BLOCK_END = /<\/(?:p|div|li|tr|h[1-6]|blockquote)>/i;

const LATEX_ATTRIBUTE = /data-latex="[^"]*"/g;

/** One line a paragraph, then every image key, so the cell folds to the stem hash the html did. */
export function cellTextOf(content: RichContent | undefined): string {
  // Stored LaTeX keeps a bare `<`, which would end the tag early for `previewTextOf`.
  const html = plainTextOf(content).replaceAll(LATEX_ATTRIBUTE, (attribute) =>
    attribute.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  );
  const lines = html.split(BLOCK_END).map(previewTextOf);
  return [...lines, ...imageKeysIn(html)].filter((line) => line !== '').join('\n');
}

export function richContentOf(question: ExportedQuestion): string {
  const html = mapQuestionHtml(question, (text) => text);
  return [
    html.some((text) => imageKeysIn(text).length > 0) ? RICH_CONTENT.IMAGE : null,
    html.some((text) => latexIn(text).length > 0) ? RICH_CONTENT.EQUATION : null,
  ]
    .filter((label) => label !== null)
    .join(', ');
}

type CellOf = (question: ExportedQuestion) => string | null;

function perLanguage<Prefix extends string>(
  prefix: Prefix,
  value: (question: ExportedQuestion, language: QuestionLanguage) => string | null,
): Record<`${Prefix}${QuestionLanguage}`, CellOf> {
  return Object.fromEntries(
    LANGUAGE_ORDER.map((language) => [
      `${prefix}${language}`,
      (question: ExportedQuestion) => value(question, language),
    ]),
  ) as Record<`${Prefix}${QuestionLanguage}`, CellOf>;
}

const optionAt = <Position extends 1 | 2 | 3 | 4>(position: Position) =>
  perLanguage(`option${position}_` as `option${Position}_`, (question, language) => {
    const option = question.options.find((candidate) => candidate.position === position);
    return option ? cellTextOf(option.text[language]) : null;
  });

/** Exhaustive over the import's keys, so a column added there cannot be missed here. */
const IMPORT_VALUES: Record<QuestionImportColumnKey, CellOf> = {
  type: (question) => question.type,
  subject: (question) => question.subject,
  topic: (question) => question.topic,
  difficulty: (question) => question.difficulty,
  ...perLanguage('stem_', (question, language) => cellTextOf(question.content[language]?.stem)),
  ...optionAt(1),
  ...optionAt(2),
  ...optionAt(3),
  ...optionAt(4),
  correct_option: (question) => {
    const correct = question.options.find((option) => option.isCorrect);
    return correct ? String(correct.position) : null;
  },
  answer_mode: (question) => question.answerKey?.mode ?? null,
  ...perLanguage('answer_', (question, language) => question.answerKey?.answers[language] ?? null),
  answer_tolerance: (question) => question.answerKey?.tolerance?.toString() ?? null,
  ...perLanguage('solution_', (question, language) =>
    cellTextOf(question.content[language]?.solution),
  ),
  tags: (question) => question.tags.join(`${TAG_SEPARATOR} `),
  // Blank, so an edited row re-imports as a new question rather than clashing on its own code.
  question_code: () => null,
};

const QUESTION_COLUMNS: ExportColumn<ExportedQuestion>[] = [
  ...QUESTION_IMPORT_COLUMNS.map((column): ExportColumn<ExportedQuestion> => ({
    header: column.header,
    width: column.width,
    text: true,
    value: IMPORT_VALUES[column.key],
  })),
  { header: 'Status', width: 12, value: (question) => question.status },
  { header: 'Author', width: 24, value: (question) => question.author },
  { header: CODE_HEADER, width: 22, text: true, value: (question) => question.questionCode },
  {
    header: 'Created',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (question) => exportInstant(question.createdAt),
  },
  { header: 'Rich content', width: 18, value: richContentOf },
];

const AUTHORING_COLUMNS: ExportColumn<AuthoringCount>[] = [
  { header: 'Author', width: 28, value: (row) => row.author },
  ...QUESTION_STATUSES.map((status): ExportColumn<AuthoringCount> => ({
    header: status,
    width: 12,
    value: (row) => row.byStatus[status],
  })),
  {
    header: 'Total',
    width: 12,
    value: (row) => Object.values(row.byStatus).reduce((sum, count) => sum + count, 0),
  },
];

export function writeQuestionExport(
  questions: ExportedQuestion[],
  authoring: AuthoringCount[],
): Promise<Buffer> {
  return writeWorkbook([
    { name: QUESTION_IMPORT_SHEETS.QUESTIONS, columns: QUESTION_COLUMNS, rows: questions },
    { name: 'Authoring summary', columns: AUTHORING_COLUMNS, rows: authoring },
  ]);
}
