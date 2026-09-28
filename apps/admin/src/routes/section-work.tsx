import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, FilePlus2, Layers, Send, Undo2, Upload } from 'lucide-react';
import {
  DIFFICULTY_LABELS,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type AssignmentWithTest,
} from '@iace/contracts';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  EmptyState,
  EMPTY_STATE_KINDS,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  cn,
  linkVariants,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { SectionThreadButton } from '../components/section-thread';
import { QuestionsWindow } from '../components/authoring/questions-window';
import { SectionGridPanel } from '../components/authoring/section-grid-panel';
import { TypistDoneDialog } from '../components/authoring/typist-done-dialog';
import {
  SECTION_ADD,
  SECTION_MOMENTS,
  SECTION_PRIMARY,
  SECTION_VIEWERS,
  momentOf,
  seatOf,
  slotsFor,
  type SectionSeat,
  type SectionSlots,
} from '../components/authoring/section-moment';
import {
  useSectionRows,
  useSectionSource,
  type SectionKey,
  type SectionRow,
} from '../components/authoring/section-sources';
import { FinalizeAssignmentDialog, SendBackDialog } from './assignment-queue';

/** One section of one test, for whoever has it: the same grid, with what they may do beside it. */
export function SectionWorkPage() {
  const { testId = '', sectionId = '', questionId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { identity, can } = useAuth();
  const isSuperAdmin = identity?.isSuperAdmin ?? false;
  const section: SectionKey = useMemo(() => ({ testId, sectionId }), [testId, sectionId]);

  const mine = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'mine', 'section', testId, sectionId],
    queryFn: () => api.admin.assignments.mine({ testId, baseConfigSectionId: sectionId }),
  });
  const seat = mine.data ? seatOf(mine.data.items, search.get('as')) : null;
  const owns = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ);
  const test = useQuery({
    queryKey: [...QUERY_KEYS.TEST, testId],
    queryFn: () => api.admin.tests.detail(testId),
    enabled: owns,
  });
  const refused = seat?.viewer === SECTION_VIEWERS.OWNER && !owns;
  const rows = useSectionRows(refused ? null : seat, section);

  const names = namesOf(seat?.row ?? null, test.data, sectionId);
  const offered = Boolean(test.data?.finalizedAt);
  const moment = seat ? momentOf(seat, offered) : null;
  const slots = seat && moment ? slotsFor(seat, moment, isSuperAdmin) : null;

  const open = (id: string) =>
    navigate(withSearch(ROUTES.SECTION_QUESTION(testId, sectionId, id), search));
  const list = rows.data ?? [];
  const orderOf = (id: string) => list.findIndex((row) => row.id === id) + 1;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: names.section }]} />}
      title={names.section}
      meta={metaOf(names.test, rows.data?.length, seat?.row?.sectionQuestionCount)}
      action={
        seat && slots ? (
          <SectionActions
            seat={seat}
            slots={slots}
            section={section}
            covering={rows.data?.length ?? 0}
            canComment={seat.viewer !== SECTION_VIEWERS.OWNER || isSuperAdmin}
            canOpenPaper={owns}
          />
        ) : null
      }
    />
  );

  if (refused) {
    return (
      <TableFrame header={header}>
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="This section is not yours to open"
          hint="Ask whoever builds the test to assign it to you."
        />
      </TableFrame>
    );
  }

  return (
    <TableFrame header={header}>
      {slots?.alert ? <Alert variant={slots.alert.variant}>{slots.alert.text}</Alert> : null}

      <DataTable
        columns={columnsOf(seat, slots, moment, open, orderOf)}
        rows={list}
        rowKey={(row) => row.id}
        isLoading={mine.isLoading || rows.isLoading}
        isError={mine.isError || rows.isError}
        onRetry={() => void (mine.isError ? mine.refetch() : rows.refetch())}
        empty={moment === SECTION_MOMENTS.WAITING ? 'Nothing handed over yet' : 'No questions yet'}
      />

      {seat && slots ? (
        <SectionWindow
          seat={seat}
          section={section}
          title={`${names.section} questions`}
          rows={list}
          editable={slots.editable}
          startAt={questionId ?? null}
          open={questionId !== undefined}
          onClose={() => navigate(withSearch(ROUTES.SECTION(testId, sectionId), search))}
          canComment={seat.viewer !== SECTION_VIEWERS.OWNER || isSuperAdmin}
        />
      ) : null}
    </TableFrame>
  );
}

/** The `?as=` a queue row opened with rides along, so the window and the grid agree on who is looking. */
function withSearch(path: string, search: URLSearchParams): string {
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function namesOf(
  row: AssignmentWithTest | null,
  test:
    { title: string | null; baseConfig: { sections: { id: string; name: string }[] } } | undefined,
  sectionId: string,
) {
  return {
    section:
      row?.sectionName ??
      test?.baseConfig.sections.find((one) => one.id === sectionId)?.name ??
      'Section',
    test: row?.testTitle ?? test?.title ?? null,
  };
}

function metaOf(testTitle: string | null, held: number | undefined, needed: number | undefined) {
  const title = testTitle ?? 'Untitled test';
  if (held === undefined) return title;
  return needed === undefined
    ? `${title} · ${plural(held, 'question')}`
    : `${title} · ${held} of ${needed}`;
}

function columnsOf(
  seat: SectionSeat | null,
  slots: SectionSlots | null,
  moment: string | null,
  open: (id: string) => void,
  orderOf: (id: string) => number,
): DataTableColumn<SectionRow>[] {
  const deletes = seat?.viewer === SECTION_VIEWERS.TYPIST && moment === SECTION_MOMENTS.TYPING;
  return [
    {
      key: 'order',
      header: '#',
      numeric: true,
      className: 'w-12',
      cell: (row) => <span className="tabular-nums text-muted-foreground">{orderOf(row.id)}</span>,
    },
    {
      key: 'question',
      header: 'Question',
      className: 'max-w-xl',
      cell: (row) => (
        <button
          type="button"
          onClick={() => open(row.id)}
          className={cn(linkVariants(), 'max-w-full text-left')}
        >
          <TruncatedText>{row.preview || 'Untitled question'}</TruncatedText>
        </button>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (row) => <Badge variant="neutral">{DIFFICULTY_LABELS[row.difficulty]}</Badge>,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => (
        <RowActions label="Actions for this question">
          <DropdownMenuItem onSelect={() => open(row.id)}>
            {slots?.editable ? 'Edit' : 'Open'}
          </DropdownMenuItem>
          {deletes ? <DeleteItem row={row} /> : null}
        </RowActions>
      ),
    },
  ];
}

function SectionActions({
  seat,
  slots,
  section,
  covering,
  canComment,
  canOpenPaper,
}: Readonly<{
  seat: SectionSeat;
  slots: SectionSlots;
  section: SectionKey;
  covering: number;
  canComment: boolean;
  canOpenPaper: boolean;
}>) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'done' | 'read' | 'back' | null>(null);
  const settle = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
  const row = seat.row;
  const opened = (kind: typeof dialog) => (dialog === kind ? row : null);

  return (
    <>
      <SectionThreadButton
        testId={section.testId}
        sectionId={section.sectionId}
        canWrite={canComment}
      />
      {seat.viewer === SECTION_VIEWERS.OWNER && canOpenPaper ? (
        <Button asChild size="sm" variant="outline">
          <Link to={`${ROUTES.TEST_PAPER(section.testId)}?section=${section.sectionId}`}>
            <Layers aria-hidden />
            Open paper
          </Link>
        </Button>
      ) : null}
      {row ? <AddTools slots={slots} assignmentId={row.id} /> : null}
      {slots.sendBack ? (
        <Button size="sm" variant="outline" onClick={() => setDialog('back')}>
          <Undo2 aria-hidden />
          Send back to typist
        </Button>
      ) : null}
      {slots.primary === SECTION_PRIMARY.DONE ? (
        <Button size="sm" onClick={() => setDialog('done')}>
          <CheckCheck aria-hidden />
          Mark done
        </Button>
      ) : null}
      {slots.primary === SECTION_PRIMARY.READ ? (
        <Button size="sm" onClick={() => setDialog('read')}>
          <CheckCheck aria-hidden />
          Mark read
        </Button>
      ) : null}

      <TypistDoneDialog assignment={opened('done')} onClose={() => setDialog(null)} />
      <FinalizeAssignmentDialog
        assignment={opened('read')}
        covering={covering}
        onClose={() => setDialog(null)}
        onFinalized={settle}
      />
      <SendBackDialog
        assignment={opened('back')}
        onClose={() => setDialog(null)}
        onSentBack={settle}
      />
    </>
  );
}

function AddTools({
  slots,
  assignmentId,
}: Readonly<{ slots: SectionSlots; assignmentId: string }>) {
  return (
    <>
      {slots.add === SECTION_ADD.INTO_SECTION ? (
        <Button asChild size="sm" variant="outline">
          <Link to={ROUTES.AUTHORING_FOR_ASSIGNMENT(assignmentId)}>
            <FilePlus2 aria-hidden />
            Add question
          </Link>
        </Button>
      ) : null}
      {slots.add === SECTION_ADD.TO_BANK ? (
        <Button asChild size="sm" variant="outline">
          <Link to={ROUTES.AUTHORING_EDITOR}>
            <Send aria-hidden />
            New bank question
          </Link>
        </Button>
      ) : null}
      {slots.importSheet ? (
        <Button asChild size="sm" variant="outline">
          <Link to={ROUTES.AUTHORING_IMPORT(assignmentId)}>
            <Upload aria-hidden />
            Import sheet
          </Link>
        </Button>
      ) : null}
    </>
  );
}

/** Same shape the bank's own question prompts take, so both confirms read alike. */
const DELETE_PROMPT = { title: 'Delete this question?', confirmLabel: 'Delete' } as const;

/** A typist's own mistake, taken back while the section is still theirs. */
function DeleteItem({ row }: Readonly<{ row: SectionRow }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    meta: { success: 'Question deleted.' },
    mutationFn: () => api.admin.authoring.remove(row.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS }),
      ]);
      setAsking(false);
    },
  });

  return (
    <>
      <DropdownMenuItem destructive onSelect={() => setAsking(true)}>
        Delete
      </DropdownMenuItem>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={DELETE_PROMPT.title}
        description={`“${row.preview}” is removed for good. A question already on a paper cannot be deleted.`}
        confirmLabel={DELETE_PROMPT.confirmLabel}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function SectionWindow({
  seat,
  section,
  title,
  rows,
  editable,
  startAt,
  open,
  onClose,
  canComment,
}: Readonly<{
  seat: SectionSeat;
  section: SectionKey;
  title: string;
  rows: readonly SectionRow[];
  editable: boolean;
  startAt: string | null;
  open: boolean;
  onClose: () => void;
  canComment: boolean;
}>) {
  const source = useSectionSource({
    seat,
    section,
    title,
    rows,
    editable,
    subjectLocked: Boolean(seat.row?.sectionSubjectId),
  });

  return (
    <QuestionsWindow
      source={source}
      open={open}
      onOpenChange={(next) => !next && onClose()}
      startAt={startAt}
      aside={(position) => (
        <SectionGridPanel
          keys={source.keys}
          position={position}
          footer={
            <SectionThreadButton
              testId={section.testId}
              sectionId={section.sectionId}
              canWrite={canComment}
            />
          }
        />
      )}
    />
  );
}
