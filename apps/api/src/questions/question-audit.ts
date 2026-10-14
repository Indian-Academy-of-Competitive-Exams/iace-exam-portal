import { createHash } from 'node:crypto';
import {
  fieldDiff,
  plainTextOf,
  previewTextOf,
  type FieldDiff,
  type RichContent,
} from '@iace/contracts';
import { optionsIn } from '../common/prisma-json';
import { contentOf, type QuestionRow } from './question-rows';

/** The COLUMNS an edit can change. What the question says is flattened beside them, leaf by leaf. */
export const AUDITED_QUESTION_FIELDS = [
  'type',
  'subject',
  'topic',
  'difficulty',
  'questionCode',
  'status',
  'version',
  'correctOptionPositions',
  'answerKey',
] as const;

/** The union of both sides, so a language or an option that went away still diffs to null. */
export function questionDiff(before: QuestionRow, after: QuestionRow): FieldDiff | null {
  const from = auditFieldsOf(before);
  const to = auditFieldsOf(after);
  const fields = new Set([...AUDITED_QUESTION_FIELDS, ...Object.keys(from), ...Object.keys(to)]);
  return fieldDiff(from, to, [...fields]);
}

/** `options`, kept only as the scoring key: the sorted positions of the ones marked correct. */
function auditFieldsOf(row: QuestionRow): Record<string, unknown> {
  return {
    type: row.type,
    subject: row.subject.name,
    topic: row.topic?.name ?? null,
    difficulty: row.difficulty,
    questionCode: row.questionCode,
    status: row.status,
    version: row.currentVersion?.version ?? null,
    answerKey: row.currentVersion?.answerKey ?? null,
    correctOptionPositions: optionsIn(row.currentVersion?.options)
      .filter((option) => option.isCorrect)
      .map((option) => option.position)
      .sort((a, b) => a - b),
    ...contentLeavesOf(row),
  };
}

/** The words, not the markup — a history a proof-reader reads must not be a wall of tags. */
const readableText = (content: RichContent | undefined): string =>
  previewTextOf(plainTextOf(content));

/** `stem.EN`, `solution.HI`, `option.3.TE`: one key per thing somebody can actually retype. */
function contentLeavesOf(row: QuestionRow): Record<string, string> {
  const leaves: Record<string, string> = {};

  for (const [language, field] of Object.entries(contentOf(row))) {
    leaves[`stem.${language.toUpperCase()}`] = readableText(field?.stem);
    if (field?.passage) {
      leaves[`passage.${language.toUpperCase()}`] = readableText(field.passage);
    }
    if (field?.solution) {
      leaves[`solution.${language.toUpperCase()}`] = readableText(field.solution);
    }
  }

  for (const option of optionsIn(row.currentVersion?.options)) {
    for (const [language, text] of Object.entries(option.text)) {
      leaves[`option.${option.position}.${language.toUpperCase()}`] = readableText(text);
    }
  }

  return leaves;
}

/** Short: it is read to spot a change, never to rebuild anything. */
const CONTENT_HASH_CHARS = 16;

/** jsonb returns keys in its own order, so a freshly built object and a stored one must be levelled. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
}

/** Moves whenever what the question SAYS moves — which a draft's version number no longer does. */
export function fingerprint(content: unknown, options: unknown, answerKey: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical([content, options, answerKey])))
    .digest('hex')
    .slice(0, CONTENT_HASH_CHARS);
}

export function contentHashOf(row: QuestionRow): string | null {
  const version = row.currentVersion;
  return version ? fingerprint(version.content, version.options, version.answerKey) : null;
}
