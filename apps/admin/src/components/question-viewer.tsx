import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ANSWER_MODE,
  LANGUAGE_LABELS,
  QUESTION_TYPE,
  plainTextOf,
  previewTextOf,
  type QuestionDetail,
  type QuestionLanguage,
  type RichContent,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  BadgeList,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  SkeletonParagraph,
  StatRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  linkVariants,
} from '@iace/ui';
import { api } from '../lib/api';

/** Reading one question without leaving the screen that referred to it. */

/** The same pair the list preview uses: a node's text is html, and a reader wants neither tag. */
function readable(content: RichContent | undefined): string {
  return previewTextOf(plainTextOf(content));
}

function OneLanguage({
  question,
  language,
}: Readonly<{ question: QuestionDetail; language: QuestionLanguage }>) {
  const content = question.content[language];
  const solution = readable(content?.solution);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Question</h3>
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {readable(content?.stem) || '—'}
        </p>
      </section>

      {question.type === QUESTION_TYPE.SINGLE_MCQ ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Options</h3>
          <ol className="flex flex-col gap-2">
            {question.options.map((option, index) => (
              <li key={option.id} className="flex items-start gap-3 text-sm">
                <span className="w-5 shrink-0 font-medium text-muted-foreground">
                  {String.fromCodePoint(65 + index)}
                </span>
                <span className="flex-1 whitespace-pre-wrap text-foreground">
                  {readable(option.text[language]) || '—'}
                </span>
                {option.isCorrect ? <Badge variant="success">Correct</Badge> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Answer</h3>
          <StatRow
            label={question.answerKey?.mode === ANSWER_MODE.NUMERIC ? 'Numeric' : 'Exact text'}
            value={question.answerKey?.answers[language] || '—'}
          />
          {question.answerKey?.tolerance == null ? null : (
            <StatRow label="Tolerance" value={`± ${question.answerKey.tolerance}`} />
          )}
        </section>
      )}

      {solution ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Solution</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground">{solution}</p>
        </section>
      ) : null}
    </div>
  );
}

function Body({ question }: Readonly<{ question: QuestionDetail }>) {
  const [language, setLanguage] = useState<QuestionLanguage>(question.languages[0] ?? 'en');

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <StatRow label="Subject" value={question.subject.name} />
        <StatRow label="Topic" value={question.topic?.name ?? '—'} />
        <StatRow label="Difficulty" value={question.difficulty} />
        <StatRow label="Version" value={question.version} />
      </div>

      {question.tags.length > 0 ? (
        <BadgeList items={question.tags} label={(tag) => tag} max={8} />
      ) : null}

      <Separator />

      {question.languages.length > 1 ? (
        <Tabs
          value={language}
          onValueChange={(next) => setLanguage(next as QuestionLanguage)}
          className="flex flex-col"
        >
          <TabsList>
            {question.languages.map((code) => (
              <TabsTrigger key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </TabsTrigger>
            ))}
          </TabsList>
          {question.languages.map((code) => (
            <TabsContent key={code} value={code}>
              <OneLanguage question={question} language={code} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <OneLanguage question={question} language={language} />
      )}
    </div>
  );
}

export function QuestionViewer({
  questionId,
  onOpenChange,
}: Readonly<{ questionId: string; onOpenChange: (open: boolean) => void }>) {
  const question = useQuery({
    queryKey: ['admin', 'question', questionId],
    queryFn: () => api.admin.questions.detail(questionId),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader className="flex-col gap-1">
          <DialogTitle>{question.data?.questionCode ?? 'Question'}</DialogTitle>
          <DialogDescription>
            {question.data ? question.data.status : 'Loading the question'}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <DialogBody className="py-5">
          {question.isLoading ? <SkeletonParagraph lines={8} /> : null}
          {question.error ? <Alert variant="danger">Could not load this question.</Alert> : null}
          {question.data ? <Body question={question.data} /> : null}
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The stem or the code, as the way into the question behind it. */
export function QuestionLink({
  questionId,
  children,
}: Readonly<{ questionId: string; children: React.ReactNode }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={cn(linkVariants(), 'block w-full min-w-0 text-left')}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? <QuestionViewer questionId={questionId} onOpenChange={setOpen} /> : null}
    </>
  );
}
