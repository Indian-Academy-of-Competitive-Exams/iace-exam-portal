import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ListChecks, Upload, X } from 'lucide-react';
import { type AssignmentWithTest, type QuestionSummary } from '@iace/contracts';
import { useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  RowActions,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  TruncatedText,
  cn,
  linkVariants,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';
import { TypistDoneDialog } from './typist-done-dialog';

/** Everything the typist has written for one section, and the three things they do to it. */

/** Same shape the bank's own question prompts take, so both confirms read alike. */
const PROMPTS = {
  DELETE: { title: 'Delete this question?', confirmLabel: 'Delete' },
} as const;

const PANEL = 'w-[--modal-w-lg] gap-5';

const sectionWorkKey = (assignmentId: string) =>
  [...QUERY_KEYS.AUTHORING, 'section', assignmentId] as const;

function columnsOf(
  onEdit: (question: QuestionSummary) => void,
  onDelete: (question: QuestionSummary) => void,
): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-sm',
      cell: (question) => (
        <button
          type="button"
          onClick={() => onEdit(question)}
          className={cn(linkVariants(), 'max-w-full text-left')}
        >
          <TruncatedText>{question.stemPreview}</TruncatedText>
        </button>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (question) => <Badge variant="neutral">{question.difficulty}</Badge>,
    },
    {
      key: 'languages',
      header: 'Languages',
      cell: (question) => (
        <span className="text-sm text-muted-foreground">
          {question.languages.map((code) => code.toUpperCase()).join(' · ')}
        </span>
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (question) => (
        <RowActions label="Actions for this question">
          <DropdownMenuItem onSelect={() => onEdit(question)}>Edit</DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => onDelete(question)}>
            Delete
          </DropdownMenuItem>
        </RowActions>
      ),
    },
  ];
}

export function SectionWorkButton({
  assignment,
  onEdit,
}: Readonly<{
  assignment: AssignmentWithTest;
  /** Opens the question where the section's questions are edited; the sheet steps aside first. */
  onEdit: (questionId: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const edit = (question: QuestionSummary) => {
    setOpen(false);
    onEdit(question.id);
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ListChecks aria-hidden />
        {`Written (${assignment.writtenCount})`}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" aria-describedby={undefined} className={PANEL}>
          <div className="flex shrink-0 items-baseline gap-3 border-b border-border pb-3">
            <SheetTitle>{assignment.sectionName}</SheetTitle>
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              <TruncatedText>{assignment.testTitle ?? 'Untitled test'}</TruncatedText>
            </span>
            <SheetClose asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close">
                <X aria-hidden />
              </Button>
            </SheetClose>
          </div>

          <SectionWork assignment={assignment} onEdit={edit} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SectionWork({
  assignment,
  onEdit,
}: Readonly<{
  assignment: AssignmentWithTest;
  onEdit: (question: QuestionSummary) => void;
}>) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<QuestionSummary | null>(null);
  const [finishing, setFinishing] = useState(false);

  const written = useListScreen({
    queryKey: sectionWorkKey(assignment.id),
    filters: [],
    toQuery: () => ({ assignmentId: [assignment.id] }),
    fetchPage: (params) => api.admin.authoring.history(params),
  });

  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS }),
    ]);

  const columns = useMemo(() => columnsOf(onEdit, setDeleting), [onEdit]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {assignment.finalizedAt ? null : (
          <>
            <Button type="button" size="sm" onClick={() => setFinishing(true)}>
              <CheckCheck aria-hidden />
              Mark done
            </Button>

            <Button asChild type="button" size="sm" variant="outline">
              <Link to={ROUTES.AUTHORING_IMPORT(assignment.id)}>
                <Upload aria-hidden />
                Import a file
              </Link>
            </Button>
          </>
        )}
      </div>

      <ListView
        list={written}
        columns={columns}
        rowKey={(question) => question.id}
        empty="Nothing written for this section yet"
      />

      <TypistDoneDialog
        assignment={finishing ? assignment : null}
        onClose={() => setFinishing(false)}
      />

      <DeleteQuestionDialog
        question={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={settle}
      />
    </div>
  );
}

function DeleteQuestionDialog({
  question,
  onClose,
  onDeleted,
}: Readonly<{
  question: QuestionSummary | null;
  onClose: () => void;
  onDeleted: () => Promise<unknown>;
}>) {
  const remove = useMutation({
    meta: { success: 'Question deleted.' },
    mutationFn: (id: string) => api.admin.authoring.remove(id),
    onSuccess: async () => {
      await onDeleted();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={question !== null}
      onOpenChange={(open) => !open && onClose()}
      title={PROMPTS.DELETE.title}
      description={`“${question?.stemPreview ?? ''}” is removed for good. A question already on a paper cannot be deleted.`}
      confirmLabel={PROMPTS.DELETE.confirmLabel}
      destructive
      loading={remove.isPending}
      onConfirm={() => question?.id && remove.mutate(question.id)}
    />
  );
}
