import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSIGNMENT_ROLES, instituteDayLabel, type AssignmentWithTest } from '@iace/contracts';
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
  type BadgeProps,
  type DataTableColumn,
  type ListState,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

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

/** Written against the section's own target — the same fact the editor shows while writing. */
function progressOf(row: AssignmentWithTest): { variant: BadgeProps['variant']; label: string } {
  const { writtenCount, sectionQuestionCount } = row;
  if (writtenCount === 0) return { variant: 'neutral', label: `0/${sectionQuestionCount}` };
  return {
    variant: writtenCount < sectionQuestionCount ? 'warning' : 'success',
    label: `${writtenCount}/${sectionQuestionCount}`,
  };
}

function columnsOf(
  onFinalize: (row: AssignmentWithTest) => void,
): DataTableColumn<AssignmentWithTest>[] {
  return [
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-[16rem] font-medium',
      cell: (row) => (
        <Link to={ROUTES.AUTHORING_FOR_ASSIGNMENT(row.id)} className={linkVariants()}>
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
      cell: (row) => {
        const progress = progressOf(row);
        return <Badge variant={progress.variant}>{progress.label}</Badge>;
      },
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
            <DropdownMenuItem onSelect={() => onFinalize(row)}>Mark written</DropdownMenuItem>
          )}
        </RowActions>
      ),
    },
  ];
}

/** The typist's queue: every section handed to them, and the editor a row opens. */
export function AuthoringAssignmentsPage() {
  const queryClient = useQueryClient();
  const spec = useFilterSpec(FILTER_SPEC);
  const outstanding = spec.values.outstanding === 'true' ? 'true' : undefined;
  const [finalizing, setFinalizing] = useState<AssignmentWithTest | null>(null);

  const assignments = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'mine', ASSIGNMENT_ROLES.TYPIST, outstanding ?? null],
    queryFn: () => api.admin.assignments.mine({ role: ASSIGNMENT_ROLES.TYPIST, outstanding }),
  });

  const columns = useMemo(() => columnsOf(setFinalizing), []);

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

      <FinalizeDialog
        assignment={finalizing}
        onClose={() => setFinalizing(null)}
        onFinalized={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS })}
      />
    </TableFrame>
  );
}

function FinalizeDialog({
  assignment,
  onClose,
  onFinalized,
}: Readonly<{
  assignment: AssignmentWithTest | null;
  onClose: () => void;
  onFinalized: () => void;
}>) {
  const finalize = useMutation({
    meta: { success: assignment ? `${assignment.sectionName} marked written.` : undefined },
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
      title={`Mark ${assignment?.sectionName ?? ''} written?`}
      description={
        assignment
          ? `You have written ${assignment.writtenCount} of ${assignment.sectionQuestionCount} questions for this section in ${assignment.testTitle ?? 'this test'}. This tells the proof-reader it is ready to check.`
          : ''
      }
      confirmLabel="Mark written"
      loading={finalize.isPending}
      onConfirm={() => assignment && finalize.mutate(assignment.id)}
    />
  );
}
