import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Send, Upload, X } from 'lucide-react';
import {
  type AssignmentWithTest,
  type AuthoringRelease,
  type QuestionSummary,
} from '@iace/contracts';
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
  linkVariants,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';

/** Everything the typist has written for one section, and the three things they do to it. */

/** Same shape the bank's own question prompts take, so both confirms read alike. */
const PROMPTS = {
  RELEASE: { title: 'Hand over what is written?', confirmLabel: 'Hand over' },
  DELETE: { title: 'Delete this question?', confirmLabel: 'Delete' },
} as const;

const PANEL = 'w-[--modal-w-lg] gap-5';

const sectionWorkKey = (assignmentId: string) =>
  [...QUERY_KEYS.AUTHORING, 'section', assignmentId] as const;

function columnsOf(
  onDelete: (question: QuestionSummary) => void,
): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-sm',
      cell: (question) => (
        <Link to={ROUTES.AUTHORING_QUESTION(question.id)} className={linkVariants()}>
          <TruncatedText>{question.stemPreview}</TruncatedText>
        </Link>
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
      key: 'released',
      header: 'Handed over',
      cell: (question) => (
        <Badge variant={question.releasedAt ? 'success' : 'neutral'}>
          {question.releasedAt ? 'Yes' : 'Not yet'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (question) => (
        <RowActions label="Actions for this question">
          <DropdownMenuItem asChild>
            <Link to={ROUTES.AUTHORING_QUESTION(question.id)}>Edit</Link>
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => onDelete(question)}>
            Delete
          </DropdownMenuItem>
        </RowActions>
      ),
    },
  ];
}

export function SectionWorkButton({ assignment }: Readonly<{ assignment: AssignmentWithTest }>) {
  const [open, setOpen] = useState(false);

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

          <SectionWork assignment={assignment} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SectionWork({ assignment }: Readonly<{ assignment: AssignmentWithTest }>) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<QuestionSummary | null>(null);
  const [releasing, setReleasing] = useState(false);

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

  const columns = useMemo(() => columnsOf(setDeleting), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => setReleasing(true)}>
          <Send aria-hidden />
          Hand over
        </Button>

        <Button asChild type="button" size="sm" variant="outline">
          <Link to={ROUTES.AUTHORING_IMPORT(assignment.id)}>
            <Upload aria-hidden />
            Import a file
          </Link>
        </Button>
      </div>

      <ListView
        list={written}
        columns={columns}
        rowKey={(question) => question.id}
        empty="Nothing written for this section yet"
      />

      <ReleaseDialog
        assignment={releasing ? assignment : null}
        onClose={() => setReleasing(false)}
        onReleased={settle}
      />

      <DeleteQuestionDialog
        question={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={settle}
      />
    </div>
  );
}

function ReleaseDialog({
  assignment,
  onClose,
  onReleased,
}: Readonly<{
  assignment: AssignmentWithTest | null;
  onClose: () => void;
  onReleased: () => Promise<unknown>;
}>) {
  // Counted by the server: the rows on screen are one page, and a long section has more.
  const release = useMutation({
    meta: {
      success: (result: AuthoringRelease) =>
        `${plural(result.handedOver, 'question')} handed over.`,
    },
    mutationFn: (id: string) => api.admin.authoring.release(id),
    onSuccess: async () => {
      await onReleased();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={PROMPTS.RELEASE.title}
      description="Everything you have written and not yet handed over moves to the proof-reader. You can keep editing it afterwards, and they will see your changes."
      confirmLabel={PROMPTS.RELEASE.confirmLabel}
      loading={release.isPending}
      onConfirm={() => assignment && release.mutate(assignment.id)}
    />
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
