import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_MAX,
  MCQ_OPTION_MIN,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  hasText,
  imageKeysIn,
  latexIn,
  previewTextOf,
  toleranceSchema,
  type LocalizedText,
  type QuestionDraft,
  type QuestionIdentity,
  type QuestionLanguage,
  type QuestionType,
  type ValidationIssue,
} from './questions';
import {
  TYPING_PASSAGE_MAX_KEY_DEPRESSIONS,
  TYPING_PASSAGE_MIN_KEY_DEPRESSIONS,
  typingPassageText,
} from './typing';

/** The one definition of valid, browser-safe so the editor and the server judge alike. */

/** What the draft's ids must resolve against. Read once per request, per file, or per screen. */
export interface TaxonomyContext {
  /** `language` is set on a subject that IS a language: its questions are written in that alone. */
  subjects: Map<string, { id: string; name: string; language?: QuestionLanguage | null }>;
  topics: Map<string, { id: string; name: string; subjectId: string }>;
}

export const emptyTaxonomy = (): TaxonomyContext => ({
  subjects: new Map(),
  topics: new Map(),
});

/** Whether KaTeX will render this formula, and why not. Injected: KaTeX is not a contracts dependency. */
type MathChecker = (latex: string) => string | null;

const CODE = QUESTION_VALIDATION_CODE;

/** Markup is not content: the `<p></p>` an emptied editor box posts is an unanswered field. */
const blank = (value: string | undefined): boolean => !hasText(value);

/** Only the languages the author really filled in — an empty Telugu column is not Telugu. */
export function languagesIn(stem: LocalizedText): QuestionLanguage[] {
  return LANGUAGE_ORDER.filter((language) => !blank(stem[language]));
}

const plainOf = (value: string): string =>
  [previewTextOf(value), ...imageKeysIn(value)].join(' ').toLowerCase();

const squashed = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Case, spacing, markup and stray punctuation fold; signs and a decimal point do not: "7.5" is not "75". */
function foldForCompare(value: string | undefined): string {
  if (!value) return '';
  const kept = plainOf(value).replace(/[^\p{L}\p{N}\p{S}\p{Pd}\s.%/]/gu, '');
  return squashed(kept.replace(/(?<!\d)\.|\.(?!\d)/g, ''));
}

const stemField = (language: QuestionLanguage) => ({
  field: `stem.${language}`,
  column: `stem_${language}`,
});

const optionField = (position: number, language: QuestionLanguage) => ({
  field: `options.${position - 1}.text.${language}`,
  column: `option${position}_${language}`,
});

/** What each type answers with, and so what the draft must and must not carry. */
const ANSWER_CHECKS: Record<
  QuestionType,
  (draft: QuestionDraft, issues: ValidationIssue[], lead: QuestionLanguage) => void
> = {
  SINGLE_MCQ: checkOptions,
  TEXT_FIELD: checkTypedAnswer,
  TYPING: checkTypingPassage,
  DESCRIPTIVE: checkDescriptive,
};

/** Reported rather than thrown, so a bad row never stops the good ones beside it. */
export function validateQuestion(
  draft: QuestionDraft,
  taxonomy: TaxonomyContext,
  mathError?: MathChecker,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const subject = taxonomy.subjects.get(draft.subjectId);
  const lead = subject?.language ?? DEFAULT_LANGUAGE;
  // A language subject's question is judged in that language alone, once anything else is named.
  const judged = subject?.language ? inLanguageAlone(draft, subject, issues) : draft;

  checkLanguages(judged, issues);
  checkStems(judged, issues, subject?.language ? subject : null);
  ANSWER_CHECKS[judged.type](judged, issues, lead);
  checkTaxonomy(judged, taxonomy, issues);
  if (mathError) checkMath(draft, issues, mathError);

  return issues;
}

/** The screen can be bypassed: a draft posted straight at the API carries whatever LaTeX it likes. */
function checkMath(draft: QuestionDraft, issues: ValidationIssue[], mathError: MathChecker): void {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ...Object.entries(draft.stem).map(([language, text]) => [`stem.${language}`, text] as const),
    ...Object.entries(draft.passage ?? {}).map(
      ([language, text]) => [`passage.${language}`, text] as const,
    ),
    ...Object.entries(draft.solution ?? {}).map(
      ([language, text]) => [`solution.${language}`, text] as const,
    ),
    ...draft.options.flatMap((option, index) =>
      Object.entries(option.text).map(
        ([language, text]) => [`options.${index}.text.${language}`, text] as const,
      ),
    ),
  ];

  for (const [field, text] of fields) {
    const failure = text ? firstMathFailure(text, mathError) : null;
    if (!failure) continue;

    issues.push({
      code: CODE.MATH_INVALID,
      message: `The formula "${failure.latex}" will not render: ${failure.message}`,
      field,
    });
  }
}

/** The first formula in this content that will not render, if there is one. */
export function firstMathFailure(
  html: string,
  mathError: MathChecker,
): { latex: string; message: string } | null {
  for (const latex of latexIn(html)) {
    const message = mathError(latex);
    if (message) return { latex, message };
  }
  return null;
}

/** A Hindi Comprehension question in English is refused by name, then judged as if only its Hindi were there. */
function inLanguageAlone(
  draft: QuestionDraft,
  subject: { name: string; language?: QuestionLanguage | null },
  issues: ValidationIssue[],
): QuestionDraft {
  const language = subject.language ?? DEFAULT_LANGUAGE;
  const only = <T extends Partial<Record<string, unknown>>>(text: T | undefined): T | undefined =>
    text === undefined ? undefined : ({ [language]: text[language] } as T);
  const foreign = [
    ...Object.entries(draft.stem),
    ...Object.entries(draft.passage ?? {}),
    ...Object.entries(draft.solution ?? {}),
    ...Object.entries(draft.answerKey?.answers ?? {}),
    ...draft.options.flatMap((option) => Object.entries(option.text)),
  ].some(([key, text]) => key !== language && !blank(text as string | undefined));
  if (foreign) {
    issues.push({
      code: CODE.LANGUAGE_OUTSIDE_SUBJECT,
      message: `${subject.name} is written in ${LANGUAGE_LABELS[language]} alone`,
      field: 'subjectId',
      column: 'subject',
    });
  }
  return {
    ...draft,
    stem: only(draft.stem) ?? {},
    passage: only(draft.passage),
    solution: only(draft.solution),
    options: draft.options.map((option) => ({ ...option, text: only(option.text) ?? {} })),
    answerKey: draft.answerKey
      ? { ...draft.answerKey, answers: only(draft.answerKey.answers) ?? {} }
      : draft.answerKey,
  };
}

/** A key outside the supported set would be stored as JSON nothing renders. */
function checkLanguages(draft: QuestionDraft, issues: ValidationIssue[]): void {
  const supported = new Set<string>(LANGUAGE_ORDER);
  const seen = new Set<string>([
    ...Object.keys(draft.stem),
    ...Object.keys(draft.passage ?? {}),
    ...Object.keys(draft.solution ?? {}),
    ...Object.keys(draft.answerKey?.answers ?? {}),
    ...draft.options.flatMap((option) => Object.keys(option.text)),
  ]);

  for (const key of seen) {
    if (supported.has(key)) continue;
    issues.push({
      code: CODE.UNSUPPORTED_LANGUAGE,
      message: `"${key}" is not a language this platform holds questions in`,
      field: `stem.${key}`,
    });
  }
}

function checkStems(
  draft: QuestionDraft,
  issues: ValidationIssue[],
  languageSubject: { name: string; language?: QuestionLanguage | null } | null,
): void {
  const lead = languageSubject?.language;
  if (lead && blank(draft.stem[lead])) {
    issues.push({
      code: CODE.SUBJECT_LANGUAGE_REQUIRED,
      message: `A ${languageSubject.name} question needs its ${LANGUAGE_LABELS[lead]} question text`,
      ...stemField(lead),
    });
  } else if (!lead && blank(draft.stem[DEFAULT_LANGUAGE])) {
    issues.push({
      code: CODE.ENGLISH_STEM_REQUIRED,
      message: 'Every question needs its English question text',
      ...stemField(DEFAULT_LANGUAGE),
    });
  }

  const authored = new Set(languagesIn(draft.stem));

  for (const language of LANGUAGE_ORDER) {
    if (authored.has(language)) continue;

    const translated =
      !blank(draft.passage?.[language]) ||
      !blank(draft.solution?.[language]) ||
      !blank(draft.answerKey?.answers[language]) ||
      draft.options.some((option) => !blank(option.text[language]));

    if (translated) {
      issues.push({
        code: CODE.TRANSLATION_WITHOUT_STEM,
        message: `There is ${LANGUAGE_LABELS[language]} here but no ${LANGUAGE_LABELS[language]} question text`,
        ...stemField(language),
      });
    }
  }
}

function checkOptions(
  draft: QuestionDraft,
  issues: ValidationIssue[],
  lead: QuestionLanguage,
): void {
  if (draft.answerKey) {
    issues.push({
      code: CODE.ANSWER_NOT_ALLOWED,
      message: 'A multiple-choice question is answered by an option, not a typed answer',
      field: 'answerKey',
      column: 'answer_en',
    });
  }

  if (draft.options.length < MCQ_OPTION_MIN || draft.options.length > MCQ_OPTION_MAX) {
    issues.push({
      code: CODE.OPTION_COUNT_INVALID,
      message: `A multiple-choice question needs ${MCQ_OPTION_MIN} to ${MCQ_OPTION_MAX} options`,
      field: 'options',
      column: 'option1_en',
    });
  }

  // Only the languages it really has: a half-translated paper is unusable in that language.
  for (const language of languagesIn(draft.stem)) {
    for (const option of draft.options) {
      if (blank(option.text[language])) {
        issues.push({
          code: CODE.OPTION_TEXT_REQUIRED,
          message: `Option ${option.position} has no ${LANGUAGE_LABELS[language]} text`,
          ...optionField(option.position, language),
        });
      }
    }
  }

  const leadTexts = draft.options
    .map((option) => foldForCompare(option.text[lead]))
    .filter((text) => text !== '');
  if (new Set(leadTexts).size !== leadTexts.length) {
    issues.push({
      code: CODE.OPTION_TEXT_DUPLICATE,
      message: 'Two options say the same thing',
      field: 'options',
      column: 'option1_en',
    });
  }

  const correct = draft.options.filter((option) => option.isCorrect);
  if (correct.length === 0) {
    issues.push({
      code: CODE.CORRECT_OPTION_REQUIRED,
      message: 'Mark which option is correct',
      field: 'options',
      column: 'correct_option',
    });
  } else if (correct.length > 1) {
    issues.push({
      code: CODE.CORRECT_OPTION_INVALID,
      message: 'Exactly one option can be correct',
      field: 'options',
      column: 'correct_option',
    });
  }

  // Seats, not names: a paper draws them in order, so 1, 2, 4 would move an option up a letter.
  const seated = draft.options.map((option) => option.position).sort((a, b) => a - b);
  if (seated.some((position, index) => position !== index + 1)) {
    issues.push({
      code: CODE.OPTION_COUNT_INVALID,
      message: 'The options skip a slot. Number them from 1 with no gaps',
      field: 'options',
      column: 'option1_en',
    });
  }
}

function checkTypedAnswer(
  draft: QuestionDraft,
  issues: ValidationIssue[],
  lead: QuestionLanguage,
): void {
  if (draft.options.length > 0) {
    issues.push({
      code: CODE.OPTIONS_NOT_ALLOWED,
      message: 'A typed-answer question has no options',
      field: 'options',
      column: 'option1_en',
    });
  }

  const answerKey = draft.answerKey;
  if (!answerKey || blank(answerKey.answers[lead])) {
    issues.push({
      code: CODE.ANSWER_REQUIRED,
      message: `A typed-answer question needs its ${LANGUAGE_LABELS[lead]} answer`,
      field: 'answerKey.answers.en',
      column: 'answer_en',
    });
    return;
  }

  if (answerKey.mode === ANSWER_MODE.NUMERIC) {
    for (const language of LANGUAGE_ORDER) {
      const answer = answerKey.answers[language];
      if (answer === undefined || blank(answer)) continue;
      const typed = answer.trim();
      if (Number.isFinite(Number(typed))) continue;
      issues.push({
        code: CODE.ANSWER_NOT_NUMERIC,
        message: `"${typed}" is not a number, and this answer is compared as one`,
        field: `answerKey.answers.${language}`,
        column: `answer_${language}`,
      });
    }
    if (!toleranceSchema.optional().safeParse(answerKey.tolerance).success) {
      issues.push({
        code: CODE.ANSWER_NOT_NUMERIC,
        message: `A tolerance is a number from 0 to ${toleranceSchema.maxValue}`,
        field: 'answerKey.tolerance',
        column: 'answer_tolerance',
      });
    }
    return;
  }

  if (answerKey.tolerance !== undefined) {
    issues.push({
      code: CODE.TOLERANCE_NOT_ALLOWED,
      message: 'A tolerance only means something for a numeric answer',
      field: 'answerKey.tolerance',
      column: 'answer_tolerance',
    });
  }
}

/** Held to what a keyboard can produce: the candidate is marked on every word of it. */
function checkTypingPassage(
  draft: QuestionDraft,
  issues: ValidationIssue[],
  lead: QuestionLanguage,
): void {
  if (draft.options.length > 0) {
    issues.push({
      code: CODE.OPTIONS_NOT_ALLOWED,
      message: 'A typing passage has no options',
      field: 'options',
      column: 'option1_en',
    });
  }
  if (draft.answerKey) {
    issues.push({
      code: CODE.ANSWER_NOT_ALLOWED,
      message: 'A typing passage has no answer',
      field: 'answerKey.answers.en',
      column: 'answer_en',
    });
  }

  const stem = draft.stem[lead] ?? '';
  if (imageKeysIn(stem).length > 0 || latexIn(stem).length > 0) {
    issues.push({
      code: CODE.TYPING_PASSAGE_NOT_PLAIN,
      message: 'A typing passage is text only: no picture and no formula',
      ...stemField(lead),
    });
  }

  const keyDepressions = typingPassageText(stem).length;
  if (keyDepressions > TYPING_PASSAGE_MAX_KEY_DEPRESSIONS) {
    issues.push({
      code: CODE.TYPING_PASSAGE_TOO_LONG,
      message: `A typing passage holds at most ${TYPING_PASSAGE_MAX_KEY_DEPRESSIONS} key depressions; this has ${keyDepressions}`,
      ...stemField(lead),
    });
  }
  if (keyDepressions > 0 && keyDepressions < TYPING_PASSAGE_MIN_KEY_DEPRESSIONS) {
    issues.push({
      code: CODE.TYPING_PASSAGE_TOO_SHORT,
      message: `A typing passage needs at least ${TYPING_PASSAGE_MIN_KEY_DEPRESSIONS} key depressions; this has ${keyDepressions}`,
      ...stemField(lead),
    });
  }
}

/** Written free: no options to choose, and limits that an answer could actually sit between. */
function checkDescriptive(draft: QuestionDraft, issues: ValidationIssue[]): void {
  if (draft.options.length > 0) {
    issues.push({
      code: CODE.OPTIONS_NOT_ALLOWED,
      message: 'A descriptive question has no options',
      field: 'options',
      column: 'option1_en',
    });
  }
  const { minWords, maxWords } = draft.answerKey?.rubric ?? {};
  if (minWords != null && maxWords != null && minWords > maxWords) {
    issues.push({
      code: CODE.WORD_LIMIT_INVALID,
      message: `The lower word limit (${minWords}) is above the upper one (${maxWords})`,
      field: 'answerKey.rubric.minWords',
      column: 'answer_en',
    });
  }
}

/** The topic-under-its-subject check no foreign key can make: the question carries both ids. */
function checkTaxonomy(
  draft: QuestionDraft,
  taxonomy: TaxonomyContext,
  issues: ValidationIssue[],
): void {
  if (!draft.subjectId) {
    issues.push({
      code: CODE.SUBJECT_REQUIRED,
      message: 'Choose a subject',
      field: 'subjectId',
      column: 'subject',
    });
    return;
  }

  const subject = taxonomy.subjects.get(draft.subjectId);
  if (!subject) {
    issues.push({
      code: CODE.SUBJECT_UNKNOWN,
      message: 'That subject is not in the question bank',
      field: 'subjectId',
      column: 'subject',
    });
  }

  const topic = draft.topicId ? taxonomy.topics.get(draft.topicId) : undefined;
  if (draft.topicId && !topic) {
    issues.push({
      code: CODE.TOPIC_UNKNOWN,
      message: 'That topic is not in the question bank',
      field: 'topicId',
      column: 'topic',
    });
  }
  if (subject && topic && topic.subjectId !== subject.id) {
    issues.push({
      code: CODE.TOPIC_NOT_IN_SUBJECT,
      message: `"${topic.name}" is not a topic of "${subject.name}"`,
      field: 'topicId',
      column: 'topic',
    });
  }
}

/** The language a question leads with: English where it has it, else the one it is written in. */
export function leadLanguageIn(stem: Partial<Record<QuestionLanguage, string>>): QuestionLanguage {
  if (!blank(stem[DEFAULT_LANGUAGE])) return DEFAULT_LANGUAGE;
  return LANGUAGE_ORDER.find((language) => !blank(stem[language])) ?? DEFAULT_LANGUAGE;
}

/** Two questions in one string: the stem, the options as a SET, and the correct one's text, in its lead language. */
export function canonicalStemKey(draft: QuestionIdentity): string {
  const lead = leadLanguageIn(draft.stem);
  const asked = canonicalAskedKey(draft, lead);
  const passage = foldForCompare(draft.passage?.[lead]);
  // Appended only when there is one, so a question without a passage keeps the hash it already has.
  return passage === '' ? asked : [asked, passage].join('||');
}

function canonicalAskedKey(draft: QuestionIdentity, lead: QuestionLanguage): string {
  const stem = foldForCompare(draft.stem[lead]);

  if (draft.type === QUESTION_TYPE.TEXT_FIELD) {
    return [stem, '', foldForCompare(draft.answerKey?.answers[lead])].join('||');
  }

  const options = draft.options
    .map((option) => foldForCompare(option.text[lead]))
    .filter((text) => text !== '')
    .sort((a, b) => a.localeCompare(b));
  const correct = draft.options.find((option) => option.isCorrect);

  return [stem, options.join('|'), foldForCompare(correct?.text[lead])].join('||');
}
