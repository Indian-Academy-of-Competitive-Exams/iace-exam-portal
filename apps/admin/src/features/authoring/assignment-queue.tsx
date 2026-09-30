import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  instituteDayLabel,
  type AssignmentRole,
  type AssignmentWithTest,
} from '@iace/contracts';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  DropdownMenuItem,
  ListView,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  linkVariants,
  type BadgeProps,
  type DataTableColumn,
  type ListFilter,
} from '@iace/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES, myAssignmentsQueryKey } from '../../lib/constants';
import { useTestSectionFilters } from './use-test-section-filters';
import { TypistDoneDialog } from './typist-done-dialog';
import { FinalizeAssignmentDialog } from './finalize-assignment-dialog';

/** One section handed to one admin, from either side of it, and the screen a row of it opens. */

const isTypist = (role: AssignmentRole) => role === ASSIGNMENT_ROLES.TYPIST;

const rowHref = (row: AssignmentWithTest): string =>
  isTypist(row.role)
    ? ROUTES.TYPING_SECTION(row.testId, row.baseConfigSectionId)
    : ROUTES.READING_SECTION(row.testId, row.baseConfigSectionId);

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
}

/** Where the section stands for this row's holder, in the words each role uses. */
function stateOf(row: AssignmentWithTest): { label: string; variant: BadgeProps['variant'] } {
  if (row.sectionDropped) return { label: 'Section dropped', variant: 'neutral' };
  if (row.replacedAt) return { label: 'Passed on', variant: 'neutral' };
  if (isTypist(row.role)) {
    return row.finalizedAt
      ? { label: 'Done', variant: 'success' }
      : { label: 'Typing', variant: 'neutral' };
  }
  if (row.finalizedAt) return { label: 'Released', variant: 'success' };
  return row.handedAt
    ? { label: 'Reading', variant: 'warning' }
    : { label: 'Not reached', variant: 'neutral' };
}

function StateBadge({ row }: Readonly<{ row: AssignmentWithTest }>) {
  const state = stateOf(row);
  return <Badge variant={state.variant}>{state.label}</Badge>;
}

function RowMenu({ row, moves }: Readonly<{ row: AssignmentWithTest; moves: RowMoves }>) {
  if (!row.canMarkDone && !row.canRelease) return null;
  return (
    <RowActions label={`Actions for ${row.sectionName}`}>
      {row.canMarkDone ? (
        <DropdownMenuItem onSelect={() => moves.onDone(row)}>Mark done</DropdownMenuItem>
      ) : null}
      {row.canRelease ? (
        <DropdownMenuItem onSelect={() => moves.onRead(row)}>Mark read</DropdownMenuItem>
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
      cell: (row) => <StateBadge row={row} />,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => <RowMenu row={row} moves={moves} />,
    },
  ];
}

/** Every section handed to this admin, typing or reading, and the workspace a row of it opens. */
/** One role's own queue: the typist's under Authoring, the reader's under Proof-reading. */
export function AssignmentQueuePage({ role }: Readonly<{ role: AssignmentRole }>) {
  const queryClient = useQueryClient();
  const [finishing, setFinishing] = useState<AssignmentWithTest | null>(null);
  const [reading, setReading] = useState<AssignmentWithTest | null>(null);

  const cascade = useTestSectionFilters({ role, mine: true });

  const filters = [
    ...cascade,
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
    queryKey: myAssignmentsQueryKey(role),
    filters,
    toQuery: (values) => ({
      role,
      outstanding: values.outstanding === 'true' ? ('true' as const) : undefined,
      testId: values.testId || undefined,
      baseConfigSectionId: values.baseConfigSectionId || undefined,
      dueFrom: values.dueFrom || undefined,
      dueTo: values.dueTo || undefined,
    }),
    fetchPage: (params) => api.admin.assignments.mine(params),
  });

  const columns = useMemo(() => columnsOf({ onDone: setFinishing, onRead: setReading }), []);
  // No card holds a section's read here, so its whole prefix can go: the section page must not show it unreleased.
  const settle = () => {
    for (const queryKey of [QUERY_KEYS.ASSIGNMENTS, QUERY_KEYS.PROOFREADING]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

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
    </TableFrame>
  );
}
