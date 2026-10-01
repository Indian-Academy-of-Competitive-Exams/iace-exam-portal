import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  instituteDayLabel,
  type SectionProgressRow,
  type SectionRoleProgress,
} from '@iace/contracts';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ListView,
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
import { api } from '../../lib/api';
import { NAV_ITEMS, ROUTES, assignmentProgressQueryKey } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { useTestSectionFilters } from './use-test-section-filters';
import { AdminMultiPicker } from '../../components/admin-multi-picker';
import { SuperAdminOnly } from '../admins/super-admin-only';

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

/** A holder opens the section as what they hold it as; anybody else, as the test's owner. */
function sectionHref(row: SectionProgressRow, held: SectionRoleProgress | null, adminId: string) {
  if (held?.assigneeId === adminId && held === row.typing) {
    return ROUTES.TYPING_SECTION(row.testId, row.baseConfigSectionId);
  }
  if (held?.assigneeId === adminId && held === row.reading) {
    return ROUTES.READING_SECTION(row.testId, row.baseConfigSectionId);
  }
  return ROUTES.TEST_SECTION(row.testId, row.baseConfigSectionId);
}

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
      cell: (row) => (
        <Link to={sectionHref(row, null, adminId)} className={linkVariants()}>
          <TruncatedText>{row.sectionName}</TruncatedText>
        </Link>
      ),
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
          href={sectionHref(row, row.typing, adminId)}
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
          href={sectionHref(row, row.reading, adminId)}
        />
      ),
    },
  ];
}

export function SectionProgressPage() {
  const { identity } = useAuth();
  const adminId = identity?.id ?? '';
  const columns = useMemo(() => columnsOf(adminId), [adminId]);

  const cascade = useTestSectionFilters(EVERY_SECTION);

  const buildFilters = (selectedAssigneeLabels: Record<string, string>) =>
    [
      ...cascade,
      {
        key: 'assigneeId',
        kind: 'customMulti',
        label: 'Assignee',
        primary: true,
        render: (control: ListFilterMultiControl) => (
          <AdminMultiPicker
            {...control}
            selectedLabels={selectedAssigneeLabels}
            placeholder="Any assignee"
          />
        ),
      },
      { key: 'dueFrom', kind: 'date', label: 'Due from' },
      { key: 'dueTo', kind: 'date', label: 'Due to' },
    ] as const satisfies readonly ListFilter[];

  const sections = useListScreen({
    queryKey: assignmentProgressQueryKey(),
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
    <SuperAdminOnly title="Section progress">
      <TableFrame header={header}>
        <ListView
          list={sections}
          filters={buildFilters(selectedAssigneeLabels)}
          columns={columns}
          rowKey={(row) => `${row.testId}:${row.baseConfigSectionId}`}
          empty="No sections yet"
          emptyFiltered="No sections match those filters"
        />
      </TableFrame>
    </SuperAdminOnly>
  );
}
