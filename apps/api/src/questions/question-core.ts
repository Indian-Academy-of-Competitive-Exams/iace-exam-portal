import { createHash } from 'node:crypto';
import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
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
  type QuestionLanguage,
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
}

/** Markup is not content: the `<p></p>` an emptied editor box posts is an unanswered field. */
const blank = (value: string | undefined): boolean => !hasText(value);

/** The one place content is written, so sanitizing, the div root and the src stripping happen here only. */
const textNode = (value: string | undefined): RichContent => {
  const safe = value === undefined || blank(value) ? '' : sanitizeContentHtml(value);
  return blank(safe) ? [] : [{ type: 'TEXT', text: asContentHtml(stripImageSrc(safe)) }];
};

/**
 * Text cells to content nodes. A language reaches the row only if it has a stem:
 * a lone translated option would render as a question with no question.
 */
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

  return { content, options, answerKey, languages, stemHash: computeStemHash(draft) };
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
  return validateAgainstRules(draft, taxonomy, mathErrorIn);
}

export function computeStemHash(draft: QuestionDraft): string {
  return createHash('sha256').update(canonicalStemKey(draft)).digest('hex');
}

/** The English stem, shortened — what a list row and an import preview show. */
export function stemPreviewOf(content: LocalizedContent, limit = 140): string {
  // Stripped BEFORE slicing: cutting html at 140 characters can land inside a tag.
  const stem = previewTextOf(plainTextOf(content[DEFAULT_LANGUAGE]?.stem));
  return stem.length > limit ? `${stem.slice(0, limit - 1)}…` : stem;
}
