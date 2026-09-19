import { Link } from 'react-router-dom';
import {
  instituteDayLabel,
  type SectionProgressRow,
  type SectionRoleProgress,
} from '@iace/contracts';
import { usePagedPicker } from '@iace/app-kit';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
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
  type ListFilterControl,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import {
  AssignmentSectionPicker,
  AssignmentTestPicker,
} from '../components/assignment-scope-picker';
import { chooseTest } from '../lib/assignment-filters';

/** How every section of every live test is going. Read only: nothing here assigns, finalizes or takes up. */

/** This screen is the institute's, not one admin's, so its pickers are never narrowed to `mine`. */
const EVERY_SECTION = {} as const;

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
  if (held.assignmentId === null) {
    const badge = <Badge variant="warning">Unassigned</Badge>;
    return href ? <Link to={href}>{badge}</Link> : badge;
  }

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

/** A super admin reaches any outstanding reading, one nobody holds on its own pair — assigning nobody. */
function readingHref(
  row: SectionProgressRow,
  adminId: string,
  isSuperAdmin: boolean,
): string | null {
  const held = row.reading;
  const mine = ownWork(held, adminId, ROUTES.PROOFREADING_SECTION);
  const outstanding = isSuperAdmin && held !== null && held.finalizedAt === null;
  if (mine || !outstanding) return mine;
  return held.assignmentId
    ? ROUTES.PROOFREADING_SECTION(held.assignmentId)
    : ROUTES.PROOFREADING_OF_SECTION(row.testId, row.baseConfigSectionId);
}

function columnsOf(adminId: string, isSuperAdmin: boolean): DataTableColumn<SectionProgressRow>[] {
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
          href={readingHref(row, adminId, isSuperAdmin)}
        />
      ),
    },
  ];
}

export function SectionProgressPage() {
  const { identity } = useAuth();
  const adminId = identity?.id ?? '';
  const isSuperAdmin = identity?.isSuperAdmin ?? false;

  // Held outside the spec: choosing another test also has to drop the section under the old one.
  const urlFilters = useFilters<'testId' | 'baseConfigSectionId'>();
  const testId = urlFilters.get('testId');
  const sectionId = urlFilters.get('baseConfigSectionId');

  const assignees = usePagedPicker({
    queryKey: [...QUERY_KEYS.ADMINS, 'section-progress-filter'],
    fetchPage: (params) => api.admin.admins.list(params),
  });

  const buildFilters = (selectedAssigneeLabels: Record<string, string>) =>
    [
      {
        key: 'testId',
        kind: 'custom',
        label: 'Test',
        primary: true,
        render: (control: ListFilterControl) => (
          <AssignmentTestPicker
            {...control}
            scope={EVERY_SECTION}
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
          <AssignmentSectionPicker {...control} scope={EVERY_SECTION} testId={testId} />
        ),
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
      testId: values.testId || undefined,
      baseConfigSectionId: values.baseConfigSectionId || undefined,
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
        columns={columnsOf(adminId, isSuperAdmin)}
        rowKey={(row) => `${row.testId}:${row.baseConfigSectionId}`}
        empty="No sections yet"
        emptyFiltered="No sections match those filters"
      />
    </TableFrame>
  );
}
