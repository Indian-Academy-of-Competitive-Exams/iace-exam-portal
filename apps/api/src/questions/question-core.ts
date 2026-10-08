import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  QUESTION_STATUS,
  canonicalStemKey,
  hasText,
  languagesIn,
  plainTextOf,
  previewTextOf,
  validateQuestion as validateAgainstRules,
  type AnswerKeyDraft,
  type LocalizedContent,
  type LocalizedRich,
  type LocalizedText,
  type QuestionDraft,
  type QuestionIdentity,
  type QuestionLanguage,
  type QuestionOption,
  type QuestionType,
  type RichContent,
  type TaxonomyContext,
  type ValidationIssue,
} from '@iace/contracts';
import { stripImageSrc } from './question-images';
import { mathErrorIn } from './question-math';
import { asContentHtml } from './question-content';
import { sanitizeContentHtml } from './question-sanitize';

/** How a question is stored, and where the shared rules in `@iace/contracts` get KaTeX bound in. */

export { emptyTaxonomy, languagesIn, type TaxonomyContext } from '@iace/contracts';

/** What `buildContent` produces: exactly the columns a Question row holds. */
export interface BuiltQuestion {
  content: LocalizedContent;
  options: { position: number; isCorrect: boolean; text: LocalizedRich }[];
  answerKey: AnswerKeyDraft | null;
  /** The languages this question was really authored in, in `LANGUAGE_ORDER`. */
  languages: QuestionLanguage[];
  stemHash: string;
  stemHashVersion: number;
}

/** Markup is not content: the `<p></p>` an emptied editor box posts is an unanswered field. */
const blank = (value: string | undefined): boolean => !hasText(value);

/** The one place content is written, so sanitizing, the div root and the src stripping happen here only. */
const textNode = (value: string | undefined): RichContent => {
  const safe = value === undefined || blank(value) ? '' : sanitizeContentHtml(value);
  return blank(safe) ? [] : [{ type: 'TEXT', text: asContentHtml(stripImageSrc(safe)) }];
};

/** Text cells to content nodes. A language reaches the row only if it has a stem: a lone translated option would render as a question with no question. */
export function buildContent(draft: QuestionDraft): BuiltQuestion {
  const languages = languagesIn(draft.stem);

  const content: LocalizedContent = {};
  for (const language of languages) {
    const solution = textNode(draft.solution?.[language]);
    content[language] = {
      stem: textNode(draft.stem[language]),
      ...(solution.length > 0 ? { solution } : {}),
    };
  }

  const options = draft.options.map((option) => {
    const text: LocalizedRich = {};
    for (const language of languages) {
      const node = textNode(option.text[language]);
      if (node.length > 0) text[language] = node;
    }
    return { position: option.position, isCorrect: option.isCorrect, text };
  });

  const answerKey = draft.answerKey ? normaliseAnswerKey(draft.answerKey, languages) : null;

  return {
    content,
    options,
    answerKey,
    languages,
    stemHash: computeStemHash(draft),
    stemHashVersion: STEM_HASH_VERSION,
  };
}

function normaliseAnswerKey(
  answerKey: AnswerKeyDraft,
  languages: QuestionLanguage[],
): AnswerKeyDraft {
  const answers: LocalizedText = {};
  for (const language of languages) {
    const answer = answerKey.answers[language];
    if (answer !== undefined && !blank(answer)) answers[language] = answer.trim();
  }

  return {
    mode: answerKey.mode,
    answers,
    ...(answerKey.mode === ANSWER_MODE.NUMERIC && answerKey.tolerance !== undefined
      ? { tolerance: answerKey.tolerance }
      : {}),
  };
}

// ============================================================================
// Validation and dedup
// ============================================================================

/** Strict where the editor is lenient: a stored formula is read by a candidate mid-test. */
export function validateQuestion(
  draft: QuestionDraft,
  taxonomy: TaxonomyContext,
): ValidationIssue[] {
  return validateAgainstRules(asStored(draft), taxonomy, mathErrorIn);
}

/** A lone foreign image or a script reads as a stem until it is sanitised, so it is judged as the empty one stored. */
function asStored(draft: QuestionDraft): QuestionDraft {
  const stem = draft.stem[DEFAULT_LANGUAGE];
  if (blank(stem) || textNode(stem).length > 0) return draft;
  return { ...draft, stem: { ...draft.stem, [DEFAULT_LANGUAGE]: '' } };
}

/** Bumped whenever canonicalStemKey's fold changes; the worker rehashes every row below it. */
export const STEM_HASH_VERSION = 2;

export function computeStemHash(draft: QuestionIdentity): string {
  return createHash('sha256').update(canonicalStemKey(draft)).digest('hex');
}

/** What a stored question still says of itself, as the rehash reads it off its current version. */
export interface StoredQuestion {
  type: QuestionType;
  content: LocalizedContent;
  options: QuestionOption[];
  answerKey: AnswerKeyDraft | null;
}

/** Through the html the editor would load and post back, so a rehash equals the next edit's hash. */
export function storedStemHash(stored: StoredQuestion): string {
  const english = (rich: LocalizedRich | undefined): LocalizedText => ({
    [DEFAULT_LANGUAGE]: plainTextOf(rich?.[DEFAULT_LANGUAGE]),
  });
  const key = canonicalStemKey({
    type: stored.type,
    stem: { [DEFAULT_LANGUAGE]: plainTextOf(stored.content[DEFAULT_LANGUAGE]?.stem) },
    options: stored.options.map((option) => ({
      position: option.position,
      isCorrect: option.isCorrect,
      text: english(option.text),
    })),
    answerKey: stored.answerKey,
  });
  return createHash('sha256').update(key).digest('hex');
}

/** The English stem, shortened — what a list row and an import preview show. */
export function stemPreviewOf(content: LocalizedContent, limit = 140): string {
  // Stripped BEFORE slicing: cutting html at 140 characters can land inside a tag.
  const stem = previewTextOf(plainTextOf(content[DEFAULT_LANGUAGE]?.stem));
  return stem.length > limit ? `${stem.slice(0, limit - 1)}…` : stem;
}

/** A typing or reading job somebody still holds open. */
const OPEN_ASSIGNMENT = { finalizedAt: null, replacedAt: null } as const;

/** What a paper may draw: work written under an assignment is its own test's until that test is done. */
export const drawableFor = (testId?: string): Prisma.QuestionWhereInput => ({
  status: { not: QUESTION_STATUS.ARCHIVED },
  currentVersionId: { not: null },
  OR: [
    { assignmentId: null },
    ...(testId ? [{ assignment: { testId } }] : []),
    { assignment: { test: { assignments: { none: OPEN_ASSIGNMENT } } } },
  ],
});

/** Written for a section of a draft test that still has a job open: its section's page changes it, not the bank. */
export const SECTION_WORK_IN_PROGRESS = {
  assignment: { test: { finalizedAt: null, assignments: { some: OPEN_ASSIGNMENT } } },
} as const satisfies Prisma.QuestionWhereInput;
