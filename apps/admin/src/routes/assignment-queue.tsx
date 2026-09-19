import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  instituteDayLabel,
  type AssignmentQueueRow,
  type AssignmentRole,
} from '@iace/contracts';
import { usePagedPicker } from '@iace/app-kit';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  MultiCombobox,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  linkVariants,
  plural,
  type BadgeProps,
  type DataTableColumn,
  type ListFilter,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';

/** One section handed to one admin, from either side of it — and, for a super admin, the unheld ones too. */

const isTypist = (role: AssignmentRole) => role === ASSIGNMENT_ROLES.TYPIST;

/** Where a row opens: the held ones open the work, an unheld section opens the test that owns it. */
const rowHref = (row: AssignmentQueueRow): string => {
  if (row.id === null) return ROUTES.TEST(row.testId);
  return isTypist(row.role)
    ? ROUTES.AUTHORING_FOR_ASSIGNMENT(row.id)
    : ROUTES.PROOFREADING_SECTION(row.id);
};

/** Two jobs, two verbs — "I wrote this" and "I read this", with no ordering between them. */
const finalizeLabel = (role: AssignmentRole) => (isTypist(role) ? 'Mark written' : 'Mark read');

function progressVariant(written: number, target: number): BadgeProps['variant'] {
  if (written === 0) return 'neutral';
  return written < target ? 'warning' : 'success';
}

/** Written against the section's own target — the same fact the editor shows while writing. */
function SectionProgress({ row }: Readonly<{ row: AssignmentQueueRow }>) {
  const { writtenCount, sectionQuestionCount } = row;

  return (
    <Badge variant={progressVariant(writtenCount, sectionQuestionCount)}>
      {`${writtenCount}/${sectionQuestionCount}`}
    </Badge>
  );
}

const ASSIGNEE_COLUMN: DataTableColumn<AssignmentQueueRow> = {
  key: 'assignee',
  header: 'Assignee',
  className: 'max-w-[12rem]',
  // Not missing data: an unheld section is the thing a super admin opened this queue to find.
  cell: (row) =>
    row.assigneeName === null ? (
      <Badge variant="warning">Unassigned</Badge>
    ) : (
      <TruncatedText>{row.assigneeName}</TruncatedText>
    ),
};

const STATE_COLUMN: DataTableColumn<AssignmentQueueRow> = {
  key: 'state',
  header: 'State',
  cell: (row) => (
    <Badge variant={row.finalizedAt ? 'success' : 'neutral'}>
      {row.finalizedAt ? 'Finalized' : 'Outstanding'}
    </Badge>
  ),
};

function columnsOf(
  role: AssignmentRole,
  isSuperAdmin: boolean,
  onFinalize: (row: AssignmentQueueRow) => void,
): DataTableColumn<AssignmentQueueRow>[] {
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
      key: 'section',
      header: 'Section',
      className: 'max-w-[14rem]',
      cell: (row) => <TruncatedText>{row.sectionName}</TruncatedText>,
    },
    ...(isSuperAdmin ? [ASSIGNEE_COLUMN] : []),
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
    ...(isSuperAdmin ? [] : [STATE_COLUMN]),
    {
      key: 'actions',
      className: 'text-right',
      // A section nobody holds has no row to finalize, so it is offered no menu at all.
      cell: (row) =>
        row.id === null || row.finalizedAt ? null : (
          <RowActions label={`Actions for ${row.sectionName}`}>
            <DropdownMenuItem onSelect={() => onFinalize(row)}>
              {finalizeLabel(role)}
            </DropdownMenuItem>
          </RowActions>
        ),
    },
  ];
}

/** Every section handed to this admin in one role, and the screen a row of it opens. */
export function AssignmentQueuePage({ role }: Readonly<{ role: AssignmentRole }>) {
  const queryClient = useQueryClient();
  const { identity } = useAuth();
  const isSuperAdmin = identity?.isSuperAdmin ?? false;
  const [finalizing, setFinalizing] = useState<AssignmentQueueRow | null>(null);

  // Nobody but a super admin is shown a row that is not their own, so only they fetch the picker.
  const assignees = usePagedPicker({
    queryKey: [...QUERY_KEYS.ADMINS, 'assignment-filter'],
    fetchPage: (params) => api.admin.admins.list(params),
    enabled: isSuperAdmin,
  });

  const buildFilters = (selectedAssigneeLabels: Record<string, string>) =>
    [
      { key: 'test', kind: 'search', label: 'Test', placeholder: 'Search tests', primary: true },
      {
        key: 'section',
        kind: 'search',
        label: 'Section',
        placeholder: 'Search sections',
        primary: true,
      },
      ...(isSuperAdmin
        ? ([
            {
              key: 'assigneeId',
              kind: 'customMulti',
              label: 'Assignee',
              primary: true,
              render: (control: ListFilterMultiControl) => (
                <MultiCombobox
                  {...control}
                  {...assignees.paging}
                  chips={false}
                  selectedLabels={selectedAssigneeLabels}
                  items={assignees.items.map((admin) => ({
                    value: admin.id,
                    label: admin.fullName ?? admin.email,
                    hint: admin.fullName ? admin.email : undefined,
                  }))}
                  placeholder="Any assignee"
                  searchPlaceholder="Search admins"
                  emptyLabel="No admin matches that"
                />
              ),
            },
          ] as const)
        : // A super admin's queue holds nothing but outstanding work, so there is no state to pick.
          ([
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
          ] as const)),
      { key: 'dueFrom', kind: 'date', label: 'Due from' },
      { key: 'dueTo', kind: 'date', label: 'Due to' },
    ] as const satisfies readonly ListFilter[];

  const queue = useListScreen({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'mine', role, isSuperAdmin],
    filters: buildFilters({}),
    toQuery: (values) => ({
      role,
      outstanding: values.outstanding === 'true' ? ('true' as const) : undefined,
      test: values.test || undefined,
      section: values.section || undefined,
      dueFrom: values.dueFrom || undefined,
      dueTo: values.dueTo || undefined,
      assigneeId: isSuperAdmin ? values.assigneeId : undefined,
    }),
    fetchPage: (params) => api.admin.assignments.mine(params),
  });

  const columns = useMemo(() => columnsOf(role, isSuperAdmin, setFinalizing), [role, isSuperAdmin]);

  // A chosen admin may sit outside the loaded picker pages; the rows on screen still name them.
  const chosen = queue.values.assigneeId;
  const selectedAssigneeLabels = Object.fromEntries(
    queue.rows.flatMap((row) =>
      row.assigneeId && row.assigneeName && chosen?.includes(row.assigneeId)
        ? [[row.assigneeId, row.assigneeName] as const]
        : [],
    ),
  );

  const header = <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="My sections" />;

  return (
    <TableFrame header={header}>
      <ListView
        list={queue}
        filters={buildFilters(selectedAssigneeLabels)}
        columns={columns}
        rowKey={(row) => row.id ?? `${row.testId}:${row.baseConfigSectionId}:${row.role}`}
        empty={isSuperAdmin ? 'No sections waiting for work' : 'No sections assigned yet'}
        emptyFiltered="No sections match those filters"
      />

      <FinalizeAssignmentDialog
        role={role}
        assignment={finalizing}
        onClose={() => setFinalizing(null)}
        onFinalized={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS })}
      />
    </TableFrame>
  );
}

function promptFor(role: AssignmentRole, assignment: AssignmentQueueRow, covering: number) {
  const test = assignment.testTitle ?? 'this test';

  if (isTypist(role)) {
    return {
      title: `Mark ${assignment.sectionName} written?`,
      description: `You have written ${assignment.writtenCount} of ${assignment.sectionQuestionCount} questions for this section in ${test}. This tells the proof-reader it is ready to check.`,
      confirmLabel: 'Mark written',
      success: `${assignment.sectionName} marked written.`,
    };
  }

  return {
    title: `Mark ${assignment.sectionName} read?`,
    description: `This covers ${plural(covering, 'question')} in ${test}. You cannot edit them afterwards, and the test is one section closer to being offered.`,
    confirmLabel: 'Mark read',
    success: `${assignment.sectionName} marked read.`,
  };
}

export function FinalizeAssignmentDialog({
  role,
  assignment,
  covering,
  onClose,
  onFinalized,
}: Readonly<{
  role: AssignmentRole;
  assignment: AssignmentQueueRow | null;
  /** What the section actually holds — the queue knows the typed ones, the section screen all of them. */
  covering?: number;
  onClose: () => void;
  onFinalized: () => void;
}>) {
  const prompt = assignment
    ? promptFor(role, assignment, covering ?? assignment.writtenCount)
    : null;

  const finalize = useMutation({
    meta: { success: prompt?.success },
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
      title={prompt?.title ?? ''}
      description={prompt?.description ?? ''}
      confirmLabel={prompt?.confirmLabel ?? finalizeLabel(role)}
      loading={finalize.isPending}
      onConfirm={() => assignment?.id && finalize.mutate(assignment.id)}
    />
  );
}
