import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  instituteDayLabel,
  type Assignment,
  type AssignmentRole,
  type AssignmentWithTest,
} from '@iace/contracts';
import { PageCrumbs, useFilterSpec } from '@iace/app-kit/browser';
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
  type ListState,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

/** One section handed to one admin, from either side of it — a typist's queue and a reader's queue. */

const FILTER_SPEC = [
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
] as const;

const isTypist = (role: AssignmentRole) => role === ASSIGNMENT_ROLES.TYPIST;

/** Where a row opens: the typist types into the editor, the reader reads the section. */
const rowHref = (role: AssignmentRole, id: string) =>
  isTypist(role) ? ROUTES.AUTHORING_FOR_ASSIGNMENT(id) : ROUTES.PROOFREADING_SECTION(id);

/** Two jobs, two verbs — "I wrote this" and "I read this", with no ordering between them. */
const finalizeLabel = (role: AssignmentRole) => (isTypist(role) ? 'Mark written' : 'Mark read');

function progressVariant(written: number, target: number): BadgeProps['variant'] {
  if (written === 0) return 'neutral';
  return written < target ? 'warning' : 'success';
}

/** Written against the section's own target — the same fact the editor shows while writing. */
function SectionProgress({ row }: Readonly<{ row: Assignment }>) {
  const { writtenCount, sectionQuestionCount } = row;

  return (
    <Badge variant={progressVariant(writtenCount, sectionQuestionCount)}>
      {`${writtenCount}/${sectionQuestionCount}`}
    </Badge>
  );
}

function columnsOf(
  role: AssignmentRole,
  onFinalize: (row: AssignmentWithTest) => void,
): DataTableColumn<AssignmentWithTest>[] {
  return [
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-[16rem] font-medium',
      cell: (row) => (
        <Link to={rowHref(role, row.id)} className={linkVariants()}>
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
      cell: (row) => (
        <RowActions label={`Actions for ${row.sectionName}`}>
          {row.finalizedAt ? null : (
            <DropdownMenuItem onSelect={() => onFinalize(row)}>
              {finalizeLabel(role)}
            </DropdownMenuItem>
          )}
        </RowActions>
      ),
    },
  ];
}

/** Every section handed to this admin in one role, and the screen a row of it opens. */
export function AssignmentQueuePage({ role }: Readonly<{ role: AssignmentRole }>) {
  const queryClient = useQueryClient();
  const spec = useFilterSpec(FILTER_SPEC);
  const outstanding = spec.values.outstanding === 'true' ? 'true' : undefined;
  const [finalizing, setFinalizing] = useState<AssignmentWithTest | null>(null);

  const assignments = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'mine', role, outstanding ?? null],
    queryFn: () => api.admin.assignments.mine({ role, outstanding }),
  });

  const columns = useMemo(() => columnsOf(role, setFinalizing), [role]);

  const list: ListState<AssignmentWithTest> = {
    rows: assignments.data ?? [],
    isLoading: assignments.isLoading,
    hasLoaded: assignments.data !== undefined,
    isError: assignments.isError,
    retry: assignments.refetch,
    values: spec.values,
    setFilter: spec.setFilter,
    clearFilters: spec.clearFilters,
  };

  const header = <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="My sections" />;

  return (
    <TableFrame header={header}>
      <ListView
        list={list}
        filters={FILTER_SPEC}
        columns={columns}
        rowKey={(row) => row.id}
        empty="No sections assigned yet"
        emptyFiltered="No outstanding sections"
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

function promptFor(role: AssignmentRole, assignment: AssignmentWithTest, covering: number) {
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
  assignment: AssignmentWithTest | null;
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
      onConfirm={() => assignment && finalize.mutate(assignment.id)}
    />
  );
}
