import { Link } from 'react-router-dom';
import {
  instituteDayLabel,
  type SectionProgressRow,
  type SectionRoleProgress,
} from '@iace/contracts';
import { usePagedPicker } from '@iace/app-kit';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ListView,
  MultiCombobox,
  PageHeader,
  TableFrame,
  TruncatedText,
  cn,
  linkVariants,
  type BadgeProps,
  type DataTableColumn,
  type ListFilter,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';

/** How every section of every live test is going. Read only: nothing here assigns, finalizes or takes up. */

function progressVariant(written: number, target: number): BadgeProps['variant'] {
  if (written === 0) return 'neutral';
  return written < target ? 'warning' : 'success';
}

/** A section fact: the questions written under either role, against the section's own target. */
function SectionProgress({ row }: Readonly<{ row: SectionProgressRow }>) {
  const { writtenCount, sectionQuestionCount } = row;

  return (
    <Badge variant={progressVariant(writtenCount, sectionQuestionCount)}>
      {`${writtenCount}/${sectionQuestionCount}`}
    </Badge>
  );
}

/** Who holds one half of a section, whether they have finished, and when it is wanted. */
function RoleCell({
  held,
  doneLabel,
  href,
}: Readonly<{ held: SectionRoleProgress | null; doneLabel: string; href: string | null }>) {
  // The paper's source gives this role nothing to do — a picked paper is drawn, never typed.
  if (held === null) return <TruncatedText>{null}</TruncatedText>;
  if (held.assignmentId === null) return <Badge variant="warning">Unassigned</Badge>;

  const name = <TruncatedText>{held.assigneeName}</TruncatedText>;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {href ? (
          <Link to={href} className={cn(linkVariants(), 'min-w-0')}>
            {name}
          </Link>
        ) : (
          name
        )}
        <Badge variant={held.finalizedAt ? 'success' : 'neutral'} className="shrink-0">
          {held.finalizedAt ? doneLabel : 'Outstanding'}
        </Badge>
      </div>
      <TruncatedText className="text-xs text-muted-foreground">
        {held.dueAt ? `Due ${instituteDayLabel(held.dueAt)}` : null}
      </TruncatedText>
    </div>
  );
}

/** Their own work is the one thing a progress view still has to open; everything else is a read. */
const ownWork = (
  held: SectionRoleProgress | null,
  adminId: string,
  to: (assignmentId: string) => string,
): string | null =>
  held?.assignmentId && held.assigneeId === adminId ? to(held.assignmentId) : null;

function columnsOf(adminId: string): DataTableColumn<SectionProgressRow>[] {
  return [
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-[16rem] font-medium',
      cell: (row) => (
        <Link to={ROUTES.TEST(row.testId)} className={linkVariants()}>
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
      key: 'questions',
      header: 'Questions',
      cell: (row) => <SectionProgress row={row} />,
    },
    {
      key: 'typing',
      header: 'Typing',
      className: 'max-w-[15rem]',
      cell: (row) => (
        <RoleCell
          held={row.typing}
          doneLabel="Written"
          href={ownWork(row.typing, adminId, ROUTES.AUTHORING_FOR_ASSIGNMENT)}
        />
      ),
    },
    {
      key: 'reading',
      header: 'Proof-reading',
      className: 'max-w-[15rem]',
      cell: (row) => (
        <RoleCell
          held={row.reading}
          doneLabel="Read"
          href={ownWork(row.reading, adminId, ROUTES.PROOFREADING_SECTION)}
        />
      ),
    },
  ];
}

export function SectionProgressPage() {
  const { identity } = useAuth();
  const adminId = identity?.id ?? '';

  const assignees = usePagedPicker({
    queryKey: [...QUERY_KEYS.ADMINS, 'section-progress-filter'],
    fetchPage: (params) => api.admin.admins.list(params),
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
      { key: 'dueFrom', kind: 'date', label: 'Due from' },
      { key: 'dueTo', kind: 'date', label: 'Due to' },
    ] as const satisfies readonly ListFilter[];

  const sections = useListScreen({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'progress'],
    filters: buildFilters({}),
    toQuery: (values) => ({
      test: values.test || undefined,
      section: values.section || undefined,
      dueFrom: values.dueFrom || undefined,
      dueTo: values.dueTo || undefined,
      assigneeId: values.assigneeId,
    }),
    fetchPage: (params) => api.admin.assignments.progress(params),
  });

  // A chosen admin may sit outside the loaded picker pages; the rows on screen still name them.
  const chosen = sections.values.assigneeId;
  const selectedAssigneeLabels = Object.fromEntries(
    sections.rows.flatMap((row) =>
      [row.typing, row.reading].flatMap((held) =>
        held?.assigneeId && held.assigneeName && chosen?.includes(held.assigneeId)
          ? [[held.assigneeId, held.assigneeName] as const]
          : [],
      ),
    ),
  );

  const header = (
    <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Section progress" />
  );

  return (
    <TableFrame header={header}>
      <ListView
        list={sections}
        filters={buildFilters(selectedAssigneeLabels)}
        columns={columnsOf(adminId)}
        rowKey={(row) => `${row.testId}:${row.baseConfigSectionId}`}
        empty="No sections yet"
        emptyFiltered="No sections match those filters"
      />
    </TableFrame>
  );
}
