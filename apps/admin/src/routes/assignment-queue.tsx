import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  instituteDayLabel,
  type AssignmentRole,
  type AssignmentWithTest,
} from '@iace/contracts';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  linkVariants,
  plural,
  type BadgeProps,
  type DataTableColumn,
  type ListFilter,
  type ListFilterControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { ASSIGNMENT_ROLE_LABELS, NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { SECTION_AS } from '../components/authoring/section-moment';
import {
  AssignmentSectionPicker,
  AssignmentTestPicker,
} from '../components/assignment-scope-picker';
import { chooseTest } from '../lib/assignment-filters';
import { TypistDoneDialog } from '../components/authoring/typist-done-dialog';

/** One section handed to one admin, from either side of it, and the screen a row of it opens. */

const isTypist = (role: AssignmentRole) => role === ASSIGNMENT_ROLES.TYPIST;

const ASSIGNMENT_ROLE_ORDER = [ASSIGNMENT_ROLES.TYPIST, ASSIGNMENT_ROLES.PROOFREADER] as const;

const roleOf = (value: string | undefined): AssignmentRole | undefined =>
  ASSIGNMENT_ROLE_ORDER.find((one) => one === value);

const rowHref = (row: AssignmentWithTest): string => {
  const section = ROUTES.SECTION(row.testId, row.baseConfigSectionId);
  return isTypist(row.role) ? section : `${section}?as=${SECTION_AS.READER}`;
};

function progressVariant(written: number, target: number): BadgeProps['variant'] {
  if (written === 0) return 'neutral';
  return written < target ? 'warning' : 'success';
}

/** Written against the section's own target — the same fact the editor shows while writing. */
function SectionProgress({ row }: Readonly<{ row: AssignmentWithTest }>) {
  const { writtenCount, sectionQuestionCount } = row;

  return (
    <Badge variant={progressVariant(writtenCount, sectionQuestionCount)}>
      {`${writtenCount}/${sectionQuestionCount}`}
    </Badge>
  );
}

interface RowMoves {
  onDone: (row: AssignmentWithTest) => void;
  onRead: (row: AssignmentWithTest) => void;
  onSendBack: (row: AssignmentWithTest) => void;
}

/** What an outstanding row can do next: a typist marks done; a reader, once the typist has, reads or sends back. */
function RowMenu({ row, moves }: Readonly<{ row: AssignmentWithTest; moves: RowMoves }>) {
  if (row.finalizedAt) return null;
  if (isTypist(row.role)) {
    return (
      <RowActions label={`Actions for ${row.sectionName}`}>
        <DropdownMenuItem onSelect={() => moves.onDone(row)}>Mark done</DropdownMenuItem>
      </RowActions>
    );
  }
  if (row.typistDone === false) return null;
  return (
    <RowActions label={`Actions for ${row.sectionName}`}>
      <DropdownMenuItem onSelect={() => moves.onRead(row)}>Mark read</DropdownMenuItem>
      {row.typistDone ? (
        <DropdownMenuItem onSelect={() => moves.onSendBack(row)}>
          Send back to typist
        </DropdownMenuItem>
      ) : null}
    </RowActions>
  );
}

function columnsOf(moves: RowMoves): DataTableColumn<AssignmentWithTest>[] {
  return [
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-[16rem] font-medium',
      cell: (row) => (
        <Link to={rowHref(row)} className={linkVariants()}>
          <TruncatedText>{row.testTitle ?? 'Untitled test'}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => <Badge variant="neutral">{ASSIGNMENT_ROLE_LABELS[row.role]}</Badge>,
    },
    {
      key: 'section',
      header: 'Section',
      className: 'max-w-[14rem]',
      cell: (row) => <TruncatedText>{row.sectionName}</TruncatedText>,
    },
    {
      key: 'due',
      header: 'Due',
      className: 'max-w-40',
      cell: (row) => (
        <TruncatedText className="text-muted-foreground">
          {row.dueAt ? instituteDayLabel(row.dueAt) : 'No due date'}
        </TruncatedText>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (row) => <SectionProgress row={row} />,
    },
    {
      key: 'state',
      header: 'State',
      cell: (row) => (
        <Badge variant={row.finalizedAt ? 'success' : 'neutral'}>
          {row.finalizedAt ? 'Finalized' : 'Outstanding'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => <RowMenu row={row} moves={moves} />,
    },
  ];
}

/** Every section handed to this admin, typing or reading, and the workspace a row of it opens. */
export function AssignmentQueuePage() {
  const queryClient = useQueryClient();
  const [finishing, setFinishing] = useState<AssignmentWithTest | null>(null);
  const [reading, setReading] = useState<AssignmentWithTest | null>(null);
  const [sendingBack, setSendingBack] = useState<AssignmentWithTest | null>(null);

  // Held outside the spec: choosing another test also has to drop the section under the old one.
  const urlFilters = useFilters<'testId' | 'baseConfigSectionId'>();
  const testId = urlFilters.get('testId');
  const sectionId = urlFilters.get('baseConfigSectionId');
  const scope = { mine: true };

  const filters = [
    {
      key: 'testId',
      kind: 'custom',
      label: 'Test',
      primary: true,
      render: (control: ListFilterControl) => (
        <AssignmentTestPicker
          {...control}
          scope={scope}
          onChange={(value) => urlFilters.set(chooseTest(value, testId, sectionId))}
        />
      ),
    },
    {
      key: 'baseConfigSectionId',
      kind: 'custom',
      label: 'Section',
      primary: true,
      render: (control: ListFilterControl) => (
        <AssignmentSectionPicker {...control} scope={scope} testId={testId} />
      ),
    },
    {
      key: 'role',
      kind: 'choice',
      label: 'Role',
      primary: true,
      items: [
        { value: '', label: 'Both' },
        ...ASSIGNMENT_ROLE_ORDER.map((one) => ({ value: one, label: ASSIGNMENT_ROLE_LABELS[one] })),
      ],
    },
    {
      key: 'outstanding',
      kind: 'choice',
      label: 'State',
      primary: true,
      items: [
        { value: '', label: 'All' },
        { value: 'true', label: 'Outstanding' },
      ],
    },
    { key: 'dueFrom', kind: 'date', label: 'Due from' },
    { key: 'dueTo', kind: 'date', label: 'Due to' },
  ] as const satisfies readonly ListFilter[];

  const queue = useListScreen({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'mine'],
    filters,
    toQuery: (values) => ({
      role: roleOf(values.role),
      outstanding: values.outstanding === 'true' ? ('true' as const) : undefined,
      testId: values.testId || undefined,
      baseConfigSectionId: values.baseConfigSectionId || undefined,
      dueFrom: values.dueFrom || undefined,
      dueTo: values.dueTo || undefined,
    }),
    fetchPage: (params) => api.admin.assignments.mine(params),
  });

  const columns = useMemo(
    () => columnsOf({ onDone: setFinishing, onRead: setReading, onSendBack: setSendingBack }),
    [],
  );
  const settle = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });

  const header = <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="My sections" />;

  return (
    <TableFrame header={header}>
      <ListView
        list={queue}
        filters={filters}
        columns={columns}
        rowKey={(row) => row.id}
        empty="No sections assigned yet"
        emptyFiltered="No sections match those filters"
      />

      <TypistDoneDialog assignment={finishing} onClose={() => setFinishing(null)} />
      <FinalizeAssignmentDialog
        assignment={reading}
        onClose={() => setReading(null)}
        onFinalized={settle}
      />
      <SendBackDialog
        assignment={sendingBack}
        onClose={() => setSendingBack(null)}
        onSentBack={settle}
      />
    </TableFrame>
  );
}

/** A reader's "I have read this"; the typist's hand-over is the Done dialog, which chooses the paper. */
export function FinalizeAssignmentDialog({
  assignment,
  covering,
  onClose,
  onFinalized,
}: Readonly<{
  assignment: AssignmentWithTest | null;
  /** What the section actually holds — the section screen knows it; the queue reads the section's count. */
  covering?: number;
  onClose: () => void;
  onFinalized: () => void;
}>) {
  const count = covering ?? assignment?.sectionQuestionCount ?? 0;
  const test = assignment?.testTitle ?? 'this test';

  const finalize = useMutation({
    meta: { success: `${assignment?.sectionName ?? 'Section'} marked read.` },
    mutationFn: (id: string) => api.admin.assignments.finalize(id),
    onSuccess: () => {
      onFinalized();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Mark ${assignment?.sectionName ?? 'this section'} read?`}
      description={`This covers ${plural(count, 'question')} in ${test}. You cannot edit them afterwards, and the test is one section closer to being offered.`}
      confirmLabel="Mark read"
      loading={finalize.isPending}
      onConfirm={() => assignment?.id && finalize.mutate(assignment.id)}
    />
  );
}

/** The whole section goes back to its typist; what to fix is said in the section thread. */
export function SendBackDialog({
  assignment,
  onClose,
  onSentBack,
}: Readonly<{
  assignment: AssignmentWithTest | null;
  onClose: () => void;
  onSentBack: () => void;
}>) {
  const sendBack = useMutation({
    meta: { success: `${assignment?.sectionName ?? 'Section'} sent back to its typist.` },
    mutationFn: (id: string) => api.admin.assignments.sendBack(id),
    onSuccess: () => {
      onSentBack();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Send ${assignment?.sectionName ?? 'this section'} back?`}
      description={`All ${plural(assignment?.sectionQuestionCount ?? 0, 'question')} go back to the typist, and the section leaves your reading until they mark it done again. Say what to fix in the section thread.`}
      confirmLabel="Send back"
      loading={sendBack.isPending}
      onConfirm={() => assignment?.id && sendBack.mutate(assignment.id)}
    />
  );
}
