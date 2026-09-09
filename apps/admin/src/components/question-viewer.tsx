import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LANGUAGE_LABELS, type QuestionDetail, type QuestionLanguage } from '@iace/contracts';
import {
  Alert,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  linkVariants,
} from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';
import { QuestionFacts, QuestionInLanguage } from './question-body';

/** Reading one question without leaving the screen that referred to it. */

function Body({ question }: Readonly<{ question: QuestionDetail }>) {
  const [language, setLanguage] = useState<QuestionLanguage>(question.languages[0] ?? 'en');

  return (
    <div className="flex flex-col gap-5">
      <QuestionFacts question={question} />

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
              <QuestionInLanguage question={question} language={code} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <QuestionInLanguage question={question} language={language} />
      )}
    </div>
  );
}

export function QuestionViewer({
  questionId,
  onOpenChange,
}: Readonly<{ questionId: string; onOpenChange: (open: boolean) => void }>) {
  const question = useQuery({
    queryKey: [...QUERY_KEYS.QUESTION, questionId],
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
