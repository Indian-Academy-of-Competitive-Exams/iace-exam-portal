import { useState } from 'react';
import {
  Alert,
  Badge,
  RichContent,
  SectionHeading,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@iace/ui';
import {
  type ExamSection,
  type LanguageCode,
  type LanguageMode,
  type ScoreCardQuestion,
  type SolutionQuestion,
} from '@iace/contracts';
import { htmlOf, shownLanguages } from '../exam/content';

/** One question as the review holds it: always their own answer, and the key only past the gate. */
export type ReviewedQuestion = ScoreCardQuestion & Partial<SolutionQuestion>;

/** How a question went, which is what colours the palette and the marker beside an option. */
const VERDICT = { RIGHT: 'RIGHT', WRONG: 'WRONG', LEFT: 'LEFT' } as const;
type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  [VERDICT.RIGHT]: 'Correct',
  [VERDICT.WRONG]: 'Incorrect',
  [VERDICT.LEFT]: 'Unattempted',
};

const VERDICT_SEAT: Readonly<Record<Verdict, string>> = {
  [VERDICT.RIGHT]: 'border-success bg-success/15 text-success',
  [VERDICT.WRONG]: 'border-destructive bg-destructive/15 text-destructive',
  [VERDICT.LEFT]: 'border-border bg-muted text-muted-foreground',
};

const verdictOf = (question: ReviewedQuestion): Verdict => {
  if (question.isCorrect === true) return VERDICT.RIGHT;
  return question.isCorrect === false ? VERDICT.WRONG : VERDICT.LEFT;
};

export interface ReviewPaperProps {
  sections: readonly ExamSection[];
  questions: readonly ReviewedQuestion[];
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
  /** What the gate is still holding back, said once at the top rather than per question. */
  notice?: React.ReactNode;
}

/** The CBT arrangement, read-only — and a palette coloured by how each question went. */
export function ReviewPaper({
  sections,
  questions,
  languages,
  languageMode,
  notice,
}: Readonly<ReviewPaperProps>) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const inSection = questions.filter((row) => row.baseConfigSectionId === sectionId);
  const [openId, setOpenId] = useState(inSection[0]?.questionId ?? '');
  const open = inSection.find((row) => row.questionId === openId) ?? inSection[0];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {notice}

      {sections.length > 1 ? (
        <Tabs
          value={sectionId}
          onValueChange={(next) => {
            setSectionId(next);
            setOpenId('');
          }}
        >
          <TabsList>
            {sections.map((section) => (
              <TabsTrigger key={section.id} value={section.id}>
                {section.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_16rem]">
        {open ? (
          <ReviewQuestion
            question={open}
            index={inSection.indexOf(open)}
            languages={languages}
            languageMode={languageMode}
          />
        ) : (
          <Alert variant="info">Nothing was served in this section.</Alert>
        )}
        <ReviewPalette questions={inSection} openId={open?.questionId ?? ''} onOpen={setOpenId} />
      </div>
    </div>
  );
}

function ReviewQuestion({
  question,
  index,
  languages,
  languageMode,
}: Readonly<{
  question: ReviewedQuestion;
  index: number;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}>) {
  const shown = shownLanguages(languages, languageMode);
  const verdict = verdictOf(question);

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">Question {index + 1}</span>
        <span className="flex items-center gap-2">
          <Badge variant={verdict === VERDICT.RIGHT ? 'success' : 'neutral'}>
            {VERDICT_LABEL[verdict]}
          </Badge>
          <Badge variant="neutral">
            {question.marksAwarded ?? 0} / {question.marks}
          </Badge>
          <Badge variant="neutral">{question.timeSpentSec}s</Badge>
        </span>
      </div>

      {shown.map((language) => (
        <RichContent key={language} html={htmlOf(question.content?.[contentKey(language)]?.stem)} />
      ))}

      <ol className="flex flex-col gap-2">
        {(question.options ?? []).map((option, seat) => (
          <li key={option.id}>
            <ReviewOption
              seat={seat}
              html={shown.map((language) => htmlOf(option.text[contentKey(language)])).join('')}
              chosen={option.id === question.selectedOptionId}
              correct={option.isCorrect}
            />
          </li>
        ))}
      </ol>

      {question.content?.en?.solution ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <SectionHeading title="Solution" level={3} />
          {shown.map((language) => (
            <RichContent
              key={language}
              html={htmlOf(question.content?.[contentKey(language)]?.solution)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewOption({
  seat,
  html,
  chosen,
  correct,
}: Readonly<{ seat: number; html: string; chosen: boolean; correct?: boolean }>) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border p-3 text-sm',
        correct === true && 'border-success bg-success/10',
        chosen && correct !== true && 'border-destructive bg-destructive/10',
        !chosen && correct !== true && 'border-border',
      )}
    >
      <span className="mt-0.5 font-semibold tabular-nums">{String.fromCodePoint(65 + seat)}</span>
      <RichContent className="flex-1" html={html} />
      <span className="flex shrink-0 items-center gap-2">
        {chosen ? <Badge variant="neutral">Your answer</Badge> : null}
        {correct === true ? <Badge variant="success">Correct answer</Badge> : null}
      </span>
    </div>
  );
}

function ReviewPalette({
  questions,
  openId,
  onOpen,
}: Readonly<{
  questions: readonly ReviewedQuestion[];
  openId: string;
  onOpen: (questionId: string) => void;
}>) {
  const counted = (verdict: Verdict) =>
    questions.filter((question) => verdictOf(question) === verdict).length;

  return (
    <aside className="flex min-h-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        {([VERDICT.RIGHT, VERDICT.WRONG, VERDICT.LEFT] as const).map((verdict) => (
          <span key={verdict} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={cn('size-3 shrink-0 rounded-sm border', VERDICT_SEAT[verdict])} />
              {VERDICT_LABEL[verdict]}
            </span>
            <span className="font-medium tabular-nums text-foreground">{counted(verdict)}</span>
          </span>
        ))}
      </div>

      <div className="relative grid min-h-0 grid-cols-6 gap-1.5 overflow-y-auto">
        {questions.map((question, seat) => (
          <button
            key={question.questionId}
            type="button"
            aria-current={question.questionId === openId ? 'true' : undefined}
            onClick={() => onOpen(question.questionId)}
            className={cn(
              'flex size-8 items-center justify-center rounded-sm border text-xs tabular-nums',
              'focus-visible:shadow-focus focus-visible:outline-none',
              VERDICT_SEAT[verdictOf(question)],
              // Positional only: an outline, never a fill, so it cannot read as a state.
              question.questionId === openId &&
                'outline outline-2 outline-offset-1 outline-primary',
            )}
          >
            {seat + 1}
            <span className="sr-only">{VERDICT_LABEL[verdictOf(question)]}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

/** `LanguageCode` (EN) is the row's; the content JSON is keyed by the lower-case form. */
const contentKey = (language: LanguageCode) => language.toLowerCase() as 'en' | 'hi' | 'te';
