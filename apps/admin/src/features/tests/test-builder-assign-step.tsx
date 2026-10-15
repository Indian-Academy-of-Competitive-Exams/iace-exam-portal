import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  FEATURE_KEYS,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  PAPER_SOURCE_LABELS,
  scopedSections,
  instituteDayLabel,
  type Assignment,
  type AssignmentRole,
  type BaseConfigDetail,
  type BaseConfigSection,
  type TestDetail,
} from '@iace/contracts';
import { Upload, UserPlus, UserRoundPen } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  DropdownMenuItem,
  EmptyState,
  EMPTY_STATE_KINDS,
  FormSection,
  RowActions,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  linkVariants,
  type BadgeProps,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/auth';
import { ASSIGNMENT_ROLE_LABELS } from '../../lib/labels';
import { testAssignmentsQueryKey, testPaperQueryKey } from '../../lib/query-keys';
import { ROUTES } from '../../lib/constants';
import { FULLNESS_VARIANT, holderOf, sectionFullness, sectionTally } from './test-paper-view';
import {
  AssignDialog,
  DueDateDialog,
  HandOverDialog,
  RemoveDialog,
  SourceDialog,
} from './test-builder-assign-dialogs';
import { SectionThreadButton } from '../../components/section-thread';
import { DueStandingBadge } from '../../components/due-standing-badge';
import { TimeSpent } from '../../components/time-spent';

/** Sits beside the paper it staffs: who types and reads each section, before the paper is judged. */

const ROLE_ORDER = [ASSIGNMENT_ROLES.TYPIST, ASSIGNMENT_ROLES.PROOFREADER] as const;

const earlier = (rows: readonly Assignment[], section: string, role: AssignmentRole) =>
  rows.filter(
    (row) => row.baseConfigSectionId === section && row.role === role && row.replacedAt !== null,
  );

interface SectionRow {
  section: BaseConfigSection;
  typist?: Assignment;
  proofreader?: Assignment;
  earlierTypists: Assignment[];
  earlierReaders: Assignment[];
}

interface AssignTarget {
  section: BaseConfigSection;
  role: AssignmentRole;
}

export function AssignStep({
  detail,
  config,
}: Readonly<{ detail: TestDetail | null; config: BaseConfigDetail | null }>) {
  const { identity, can } = useAuth();
  const assignments = useQuery({
    queryKey: testAssignmentsQueryKey(detail?.id ?? ''),
    queryFn: () => api.admin.assignments.forTest(detail?.id ?? ''),
    enabled: Boolean(detail?.id),
  });
  const paper = useQuery({
    queryKey: testPaperQueryKey(detail?.id ?? ''),
    queryFn: () => api.admin.tests.readPaper(detail?.id ?? ''),
    enabled: Boolean(detail?.paperSource),
  });
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [moving, setMoving] = useState<Assignment | null>(null);
  const [handingOver, setHandingOver] = useState<BaseConfigSection | null>(null);

  // The server refuses anybody else, so a box they cannot post from is not shown at all.
  const mayComment = useCallback(
    (row: SectionRow): boolean =>
      (detail?.attemptCount ?? 0) === 0 &&
      ((identity?.isSuperAdmin ?? false) ||
        [row.typist, row.proofreader].some((held) => held?.assigneeId === identity?.id)),
    [identity, detail?.attemptCount],
  );

  const held = useMemo(() => (paper.data ? heldBySection(paper.data) : null), [paper.data]);
  const handable = useMemo(
    () =>
      new Set(
        paper.data?.sections
          .filter((one) => one.canHandOver)
          .map((one) => one.baseConfigSectionId) ?? [],
      ),
    [paper.data],
  );
  const columns = useMemo(
    () =>
      columnsOf({
        testId: detail?.id ?? '',
        held,
        handable,
        mayComment,
        // An offered paper takes nobody new and loses nobody: there is nothing left to type or read.
        onAssign: detail?.finalizedAt ? null : setAssigning,
        onRemove: detail?.finalizedAt ? null : setRemoving,
        onChangeDue: detail?.finalizedAt ? null : setMoving,
        onHandOver: detail?.finalizedAt ? null : setHandingOver,
      }),
    [detail?.id, detail?.finalizedAt, held, handable, mayComment],
  );

  if (!detail || !config) {
    return (
      <EmptyState title="No paper yet" /* ui-copy-ok: rule */ hint="Save this test to build one." />
    );
  }
  const sections = scopedSections(config.sections, detail.scope, detail.scopeRef);
  if (sections.length === 0) {
    return (
      <EmptyState
        title="No sections"
        /* ui-copy-ok: consequence */
        hint="This test's configuration has none, so there is no paper to build."
      />
    );
  }

  if (detail.paperSource === null) return <SourceDialog testId={detail.id} />;

  // Who holds a role and what the paper holds both decide the hand-over, so a change re-reads both.
  const reread = () => {
    void assignments.refetch();
    void paper.refetch();
  };

  // Either read missing leaves a row that misstates its section: unstaffed, or with no count held.
  if (assignments.isLoadingError || paper.isLoadingError) {
    return (
      <FormSection title="Sections">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load the sections"
          onRetry={reread}
        />
      </FormSection>
    );
  }

  const all = assignments.data ?? [];
  const rowOf = (section: BaseConfigSection): SectionRow => ({
    section,
    typist: holderOf(all, section.id, ASSIGNMENT_ROLES.TYPIST),
    proofreader: holderOf(all, section.id, ASSIGNMENT_ROLES.PROOFREADER),
    earlierTypists: earlier(all, section.id, ASSIGNMENT_ROLES.TYPIST),
    earlierReaders: earlier(all, section.id, ASSIGNMENT_ROLES.PROOFREADER),
  });
  return (
    <FormSection title="Sections" meta={PAPER_SOURCE_LABELS[detail.paperSource]}>
      {detail.paperSource === PAPER_SOURCES.FRAMED &&
      !detail.finalizedAt &&
      can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE) ? (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="outline">
            <Link to={ROUTES.TEST_IMPORT(detail.id)}>
              <Upload aria-hidden />
              Import questions
            </Link>
          </Button>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={sections.map(rowOf)}
        rowKey={(row) => row.section.id}
        isLoading={assignments.isLoading || paper.isLoading}
        empty="No sections"
      />

      {assigning ? (
        <AssignDialog
          key={`${assigning.section.id}-${assigning.role}`}
          testId={detail.id}
          section={assigning.section}
          role={assigning.role}
          onClose={() => setAssigning(null)}
          onAssigned={reread}
        />
      ) : null}

      <RemoveDialog assignment={removing} onClose={() => setRemoving(null)} onRemoved={reread} />

      {moving ? (
        <DueDateDialog
          key={moving.id}
          assignment={moving}
          onClose={() => setMoving(null)}
          onChanged={reread}
        />
      ) : null}

      <HandOverDialog
        testId={detail.id}
        section={handingOver}
        onClose={() => setHandingOver(null)}
        onHanded={() => assignments.refetch()}
      />
    </FormSection>
  );
}

function heldBySection(paper: {
  sections: readonly { baseConfigSectionId: string; questions: readonly unknown[] }[];
}): ReadonlyMap<string, number> {
  return new Map(paper.sections.map((one) => [one.baseConfigSectionId, one.questions.length]));
}

function PaperCell({
  section,
  held,
}: Readonly<{ section: BaseConfigSection; held: ReadonlyMap<string, number> | null }>) {
  const fullness = sectionFullness(section, held);
  const tally = sectionTally(section, held);
  if (!fullness || !tally) return <Badge variant="neutral">{section.questionCount}</Badge>;
  return <Badge variant={FULLNESS_VARIANT[fullness]}>{tally}</Badge>;
}

interface ColumnsInput {
  testId: string;
  held: ReadonlyMap<string, number> | null;
  /** Sections whose hand-over the server would take now. */
  handable: ReadonlySet<string>;
  mayComment: (row: SectionRow) => boolean;
  onAssign: ((target: AssignTarget) => void) | null;
  onRemove: ((assignment: Assignment) => void) | null;
  onChangeDue: ((assignment: Assignment) => void) | null;
  onHandOver: ((section: BaseConfigSection) => void) | null;
}

function columnsOf({
  testId,
  held,
  handable,
  mayComment,
  onAssign,
  onRemove,
  onChangeDue,
  onHandOver,
}: ColumnsInput): DataTableColumn<SectionRow>[] {
  return [
    {
      key: 'section',
      header: 'Section',
      className: 'max-w-[14rem] font-medium',
      cell: (row) => (
        <Link to={ROUTES.TEST_SECTION(testId, row.section.id)} className={linkVariants()}>
          <TruncatedText>{row.section.name}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'paper',
      header: 'Paper',
      cell: (row) => <PaperCell section={row.section} held={held} />,
    },
    {
      key: 'typist',
      header: 'Typist',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <RoleCell
          assignment={row.typist}
          earlier={row.earlierTypists}
          questionCount={row.section.questionCount}
          onAssign={
            onAssign
              ? () => onAssign({ section: row.section, role: ASSIGNMENT_ROLES.TYPIST })
              : undefined
          }
        />
      ),
    },
    {
      key: 'proofreader',
      header: 'Proof-reader',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <RoleCell
          assignment={row.proofreader}
          earlier={row.earlierReaders}
          questionCount={row.section.questionCount}
          onAssign={
            onAssign
              ? () => onAssign({ section: row.section, role: ASSIGNMENT_ROLES.PROOFREADER })
              : undefined
          }
        />
      ),
    },
    {
      key: 'comments',
      header: 'Comments',
      cell: (row) => (
        <SectionThreadButton
          testId={testId}
          sectionId={row.section.id}
          canWrite={mayComment(row)}
        />
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => (
        <SectionActions
          testId={testId}
          row={row}
          onRemove={onRemove}
          onChangeDue={onChangeDue}
          onHandOver={
            handable.has(row.section.id) && onHandOver ? () => onHandOver(row.section) : null
          }
        />
      ),
    },
  ];
}

/** Framed or picked, chosen in a dialog the first time the paper is opened, and never again. */
/** Assigning is the icon beside the tag now, so the menu is only ever what is already there. */
function SectionActions({
  testId,
  row,
  onRemove,
  onChangeDue,
  onHandOver,
}: Readonly<{
  testId: string;
  row: SectionRow;
  onRemove: ((assignment: Assignment) => void) | null;
  onChangeDue: ((assignment: Assignment) => void) | null;
  onHandOver: (() => void) | null;
}>) {
  return (
    <RowActions label={`Actions for ${row.section.name}`}>
      <DropdownMenuItem asChild>
        <Link to={ROUTES.TEST_SECTION(testId, row.section.id)}>Open section</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={`${ROUTES.TEST_PAPER(testId)}?section=${row.section.id}`}>Open paper</Link>
      </DropdownMenuItem>
      {onHandOver ? (
        <DropdownMenuItem onSelect={onHandOver}>Hand over to proof-reader</DropdownMenuItem>
      ) : null}
      {onChangeDue ? changeDueItemsFor(row, onChangeDue) : null}
      {onRemove ? removeItemsFor(row, onRemove) : null}
    </RowActions>
  );
}

function changeDueItemsFor(
  row: SectionRow,
  onChangeDue: (assignment: Assignment) => void,
): ReactNode[] {
  return ROLE_ORDER.flatMap((role) => {
    const assignment = role === ASSIGNMENT_ROLES.TYPIST ? row.typist : row.proofreader;
    // A finished seat keeps the day it is judged against.
    if (!assignment || assignment.finalizedAt) return [];
    return [
      <DropdownMenuItem key={role} onSelect={() => onChangeDue(assignment)}>
        Change {ASSIGNMENT_ROLE_LABELS[role].toLowerCase()} due date
      </DropdownMenuItem>,
    ];
  });
}

function removeItemsFor(row: SectionRow, onRemove: (assignment: Assignment) => void): ReactNode[] {
  const items: ReactNode[] = [];
  for (const role of ROLE_ORDER) {
    const assignment = role === ASSIGNMENT_ROLES.TYPIST ? row.typist : row.proofreader;
    const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

    // Worked under means on the record: the role passes to somebody else instead.
    if (assignment?.removable) {
      items.push(
        <DropdownMenuItem key={role} destructive onSelect={() => onRemove(assignment)}>
          Remove {word}
        </DropdownMenuItem>,
      );
    }
  }
  return items;
}

function RoleCell({
  assignment,
  earlier,
  questionCount,
  onAssign,
}: Readonly<{
  assignment: Assignment | undefined;
  earlier: readonly Assignment[];
  questionCount: number;
  onAssign?: () => void;
}>) {
  if (!assignment && !onAssign) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
  }
  if (!assignment) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">Unassigned</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={onAssign}>
              <UserPlus />
              <span className="sr-only">Assign</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Assign</TooltipContent>
        </Tooltip>
      </span>
    );
  }

  const progress = progressOf(assignment, questionCount);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1">
        <TruncatedText className="font-medium">{assignment.assigneeName}</TruncatedText>
        {onAssign ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={onAssign}>
                <UserRoundPen />
                <span className="sr-only">Give to somebody else</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Give to somebody else</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {assignment.dueAt ? `Due ${instituteDayLabel(assignment.dueAt)}` : 'No due date'}
        </span>
        <DueStandingBadge standing={assignment.standing} />
        <Badge variant={progress.variant}>{progress.label}</Badge>
        {assignment.secondsSpent === null ? null : <TimeSpent seconds={assignment.secondsSpent} />}
      </div>
      {earlier.length > 0 ? (
        <TruncatedText className="text-xs text-muted-foreground">
          {`Earlier: ${earlier.map((row) => row.assigneeName).join(', ')}`}
        </TruncatedText>
      ) : null}
    </div>
  );
}

/** A reader's state is where the section is with them; a typist's, how much of it is written. */
function progressOf(
  assignment: Assignment,
  questionCount: number,
): { variant: BadgeProps['variant']; label: string } {
  if (assignment.role === ASSIGNMENT_ROLES.PROOFREADER) {
    if (assignment.finalizedAt) return { variant: 'success', label: 'Released' };
    return assignment.handedAt
      ? { variant: 'warning', label: 'Reading' }
      : { variant: 'neutral', label: 'Not reached' };
  }
  if (assignment.finalizedAt) return { variant: 'success', label: 'Done' };
  const { writtenCount } = assignment;
  if (writtenCount === 0) return { variant: 'neutral', label: `0/${questionCount}` };
  return {
    variant: writtenCount < questionCount ? 'warning' : 'success',
    label: `${writtenCount}/${questionCount}`,
  };
}
