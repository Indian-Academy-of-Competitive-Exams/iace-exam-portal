import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  PAPER_SOURCES,
  PAPER_SOURCE_LABELS,
  scopedSections,
  instituteDayLabel,
  type Assignment,
  type AssignmentRole,
  type BaseConfigDetail,
  type BaseConfigSection,
  type PaperSource,
  type TestDetail,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { UserPlus } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  EmptyState,
  EMPTY_STATE_KINDS,
  Field,
  FormCombobox,
  FormDialog,
  FormSection,
  RowActions,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  DatePicker,
  type BadgeProps,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { ASSIGNMENT_ROLE_LABELS, QUERY_KEYS } from '../lib/constants';
import { SectionThreadButton } from '../components/section-thread';

/** Sits beside the paper it staffs: who types and reads each section, before the paper is judged. */

const ROLE_ORDER = [ASSIGNMENT_ROLES.TYPIST, ASSIGNMENT_ROLES.PROOFREADER] as const;

/** The consequence of each source, in the words the confirm repeats back before it is fixed. */
const SOURCE_CHOICES = {
  [PAPER_SOURCES.FRAMED]: {
    action: 'Have them framed',
    consequence:
      'Every section takes a typist to write its questions and a proof-reader to read them.',
  },
  [PAPER_SOURCES.PICKED]: {
    action: 'Pick them from the bank',
    consequence:
      'Every section takes a proof-reader only, and you pick its questions from the bank yourself.',
  },
} as const;

const NAMES = new Intl.ListFormat('en-IN', { style: 'long', type: 'conjunction' });

/** Only an unfinalized typist is discarded by a switch to PICKED — a finished one is a record. */
const comingOffFor = (assignments: readonly Assignment[] | undefined): Assignment[] =>
  (assignments ?? []).filter(
    (row) => row.role === ASSIGNMENT_ROLES.TYPIST && row.finalizedAt === null,
  );

interface SectionRow {
  section: BaseConfigSection;
  typist?: Assignment;
  proofreader?: Assignment;
}

interface AssignTarget {
  section: BaseConfigSection;
  role: AssignmentRole;
}

export function AssignStep({
  detail,
  config,
}: Readonly<{ detail: TestDetail | null; config: BaseConfigDetail | null }>) {
  const { identity } = useAuth();
  const assignments = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, detail?.id ?? ''],
    queryFn: () => api.admin.assignments.forTest(detail?.id ?? ''),
    enabled: Boolean(detail?.id),
  });
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [removing, setRemoving] = useState<Assignment | null>(null);

  // Nothing to staff yet: the paper step below says so, and this has nothing to add to it.
  if (!detail || !config) return null;
  const sections = scopedSections(config.sections, detail.scope, detail.scopeRef);
  if (sections.length === 0) return null;

  const comingOff = comingOffFor(assignments.data);
  if (detail.paperSource === null) {
    return <SourceChoice testId={detail.id} current={null} comingOff={comingOff} />;
  }

  if (assignments.isError) {
    return (
      <FormSection title="Assignments">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load the assignments"
          onRetry={assignments.refetch}
        />
      </FormSection>
    );
  }

  const rowOf = (section: BaseConfigSection): SectionRow => ({
    section,
    typist: assignments.data?.find(
      (row) => row.baseConfigSectionId === section.id && row.role === ASSIGNMENT_ROLES.TYPIST,
    ),
    proofreader: assignments.data?.find(
      (row) => row.baseConfigSectionId === section.id && row.role === ASSIGNMENT_ROLES.PROOFREADER,
    ),
  });
  const outstanding = (assignments.data ?? []).some((row) => row.finalizedAt === null);
  // The server refuses anybody else, so a box they cannot post from is not shown at all.
  const mayComment = (row: SectionRow): boolean =>
    (identity?.isSuperAdmin ?? false) ||
    [row.typist, row.proofreader].some((held) => held?.assigneeId === identity?.id);

  return (
    <FormSection title="Assignments" meta={PAPER_SOURCE_LABELS[detail.paperSource]}>
      {outstanding ? (
        <Alert variant="info">
          A test cannot be offered until every section is
          {detail.paperSource === PAPER_SOURCES.PICKED ? ' read.' : ' typed and read.'}
        </Alert>
      ) : null}

      <DataTable
        columns={columnsOf(detail.id, detail.paperSource, mayComment, setAssigning, setRemoving)}
        rows={sections.map(rowOf)}
        rowKey={(row) => row.section.id}
        isLoading={assignments.isLoading}
        empty="No sections"
      />

      {assigning ? (
        <AssignDialog
          key={`${assigning.section.id}-${assigning.role}`}
          testId={detail.id}
          section={assigning.section}
          role={assigning.role}
          onClose={() => setAssigning(null)}
          onAssigned={() => assignments.refetch()}
        />
      ) : null}

      <RemoveDialog
        assignment={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => assignments.refetch()}
      />

      <SourceChoice testId={detail.id} current={detail.paperSource} comingOff={comingOff} />
    </FormSection>
  );
}

function columnsOf(
  testId: string,
  source: PaperSource,
  mayComment: (row: SectionRow) => boolean,
  onAssign: (target: AssignTarget) => void,
  onRemove: (assignment: Assignment) => void,
): DataTableColumn<SectionRow>[] {
  const columns: DataTableColumn<SectionRow>[] = [
    {
      key: 'section',
      header: 'Section',
      className: 'max-w-[14rem] font-medium',
      cell: (row) => <TruncatedText>{row.section.name}</TruncatedText>,
    },
    {
      key: 'questions',
      header: 'Questions',
      numeric: true,
      cell: (row) => row.section.questionCount,
    },
    {
      key: 'typist',
      header: 'Typist',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <RoleCell
          assignment={row.typist}
          questionCount={row.section.questionCount}
          onAssign={() => onAssign({ section: row.section, role: ASSIGNMENT_ROLES.TYPIST })}
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
          questionCount={row.section.questionCount}
          onAssign={() => onAssign({ section: row.section, role: ASSIGNMENT_ROLES.PROOFREADER })}
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
      cell: (row) => <SectionActions row={row} onRemove={onRemove} />,
    },
  ];

  // A picked test has no typist to name, and an action a row cannot take is left out.
  if (source === PAPER_SOURCES.PICKED) return columns.filter((column) => column.key !== 'typist');
  return columns;
}

/** Switching to PICKED takes the unfinished typists with it, so the confirm names them first. */
function descriptionOf(
  choosing: PaperSource | null,
  comingOff: readonly Assignment[],
  mayMoveItLater: boolean,
): string {
  if (!choosing) return '';
  const discarded = choosing === PAPER_SOURCES.PICKED ? comingOff : [];
  const names = NAMES.format(discarded.map((row) => `${row.assigneeName} on ${row.sectionName}`));
  const takes = names ? ` This takes ${names} off the test.` : '';
  // Telling a super admin it cannot be undone, beside the button they undo it with, is just untrue.
  const after = mayMoveItLater
    ? ' Nobody but a super admin can move it after this.'
    : ' This cannot be undone.';
  return `${SOURCE_CHOICES[choosing].consequence}${takes}${after}`;
}

/** The one-way door: a test says where its questions come from before anybody is handed a section. */
function SourceChoice({
  testId,
  current,
  comingOff,
}: Readonly<{ testId: string; current: PaperSource | null; comingOff: readonly Assignment[] }>) {
  const { identity } = useAuth();
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState<PaperSource | null>(null);

  const choose = useMutation({
    meta: { success: 'Question source set.' },
    mutationFn: (paperSource: PaperSource) => api.admin.tests.update(testId, { paperSource }),
    onSuccess: async (saved) => {
      queryClient.setQueryData([...QUERY_KEYS.TEST, saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
      setChoosing(null);
    },
  });

  const dialog = (
    <ConfirmDialog
      open={choosing !== null}
      onOpenChange={(open) => !open && setChoosing(null)}
      destructive={choosing === PAPER_SOURCES.PICKED && comingOff.length > 0}
      title={choosing ? PAPER_SOURCE_LABELS[choosing] : ''}
      description={descriptionOf(choosing, comingOff, identity?.isSuperAdmin ?? false)}
      confirmLabel={choosing ? SOURCE_CHOICES[choosing].action : ''}
      loading={choose.isPending}
      onConfirm={() => choosing && choose.mutate(choosing)}
    />
  );

  // Already chosen: the one hand that may still move it, and nobody else is shown a door they cannot open.
  if (current !== null) {
    if (!identity?.isSuperAdmin) return null;
    const other = current === PAPER_SOURCES.FRAMED ? PAPER_SOURCES.PICKED : PAPER_SOURCES.FRAMED;
    return (
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => setChoosing(other)}>
          {SOURCE_CHOICES[other].action}
        </Button>
        {dialog}
      </div>
    );
  }

  return (
    <FormSection title="Question source">
      <Alert variant="warning">
        <span>
          {SOURCE_CHOICES.FRAMED.consequence} {SOURCE_CHOICES.PICKED.consequence} This is chosen
          once and cannot be changed.
        </span>
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setChoosing(PAPER_SOURCES.FRAMED)}>
          {SOURCE_CHOICES.FRAMED.action}
        </Button>
        <Button type="button" variant="outline" onClick={() => setChoosing(PAPER_SOURCES.PICKED)}>
          {SOURCE_CHOICES.PICKED.action}
        </Button>
      </div>

      {dialog}
    </FormSection>
  );
}

/** Assigning is the icon beside the tag now, so the menu is only ever what is already there. */
function SectionActions({
  row,
  onRemove,
}: Readonly<{ row: SectionRow; onRemove: (assignment: Assignment) => void }>) {
  const items = removeItemsFor(row, onRemove);
  if (items.length === 0) return null;
  return <RowActions label={`Actions for ${row.section.name}`}>{items}</RowActions>;
}

function removeItemsFor(row: SectionRow, onRemove: (assignment: Assignment) => void): ReactNode[] {
  const items: ReactNode[] = [];
  for (const role of ROLE_ORDER) {
    const assignment = role === ASSIGNMENT_ROLES.TYPIST ? row.typist : row.proofreader;
    const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

    if (assignment && !assignment.finalizedAt) {
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
  questionCount,
  onAssign,
}: Readonly<{
  assignment: Assignment | undefined;
  questionCount: number;
  onAssign: () => void;
}>) {
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
      <TruncatedText className="font-medium">{assignment.assigneeName}</TruncatedText>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {assignment.dueAt ? `Due ${instituteDayLabel(assignment.dueAt)}` : 'No due date'}
        </span>
        <Badge variant={progress.variant}>{progress.label}</Badge>
      </div>
    </div>
  );
}

/** Finalized reads as done outright; short of that, the count is the section's own — true for both roles. */
function progressOf(
  assignment: Assignment,
  questionCount: number,
): { variant: BadgeProps['variant']; label: string } {
  if (assignment.finalizedAt) return { variant: 'success', label: 'Finalized' };
  const { writtenCount } = assignment;
  if (writtenCount === 0) return { variant: 'neutral', label: `0/${questionCount}` };
  return {
    variant: writtenCount < questionCount ? 'warning' : 'success',
    label: `${writtenCount}/${questionCount}`,
  };
}

interface AssignFormValues {
  assigneeId: string;
  dueAt: string;
}

/** Who may hold a role — the server already narrows this to active admins holding its feature key. */
function useAssigneeOptions(role: AssignmentRole) {
  const assignable = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'assignable', role],
    queryFn: () => api.admin.assignments.assignable({ role }),
  });

  return {
    isLoading: assignable.isLoading,
    items: (assignable.data ?? []).map((admin) => ({
      value: admin.id,
      label: admin.fullName ?? 'Unnamed admin',
    })),
  };
}

function AssignDialog({
  testId,
  section,
  role,
  onClose,
  onAssigned,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  role: AssignmentRole;
  onClose: () => void;
  onAssigned: () => void;
}>) {
  const form = useForm<AssignFormValues>({ defaultValues: { assigneeId: '', dueAt: '' } });
  const dueAt = useWatch({ control: form.control, name: 'dueAt' }) ?? '';
  const assignees = useAssigneeOptions(role);
  const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

  const assign = useMutation({
    meta: { success: `${section.name} assigned to a ${word}.`, fields: ['assigneeId'] },
    mutationFn: (values: AssignFormValues) =>
      api.admin.assignments.assign(testId, {
        baseConfigSectionId: section.id,
        assigneeId: values.assigneeId,
        role,
        dueAt: values.dueAt || null,
      }),
    onSuccess: () => {
      onAssigned();
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, ['assigneeId']),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => assign.mutate(values)}
      title={`Assign a ${word} to ${section.name}`}
      submitLabel="Assign"
      loading={assign.isPending}
    >
      <FormCombobox
        form={form}
        name="assigneeId"
        label="Assignee"
        clearable={false}
        placeholder="Choose an admin"
        emptyLabel={`No admin holds ${word} access`}
        items={assignees.items}
        isLoading={assignees.isLoading}
      />

      {/* ui-copy-ok: rule */}
      <Field htmlFor="dueAt" label="Due date" hint="Optional">
        {(control) => (
          <DatePicker
            {...control}
            value={dueAt}
            onChange={(next) => form.setValue('dueAt', next, { shouldDirty: true })}
          />
        )}
      </Field>
    </FormDialog>
  );
}

function RemoveDialog({
  assignment,
  onClose,
  onRemoved,
}: Readonly<{
  assignment: Assignment | null;
  onClose: () => void;
  onRemoved: () => void;
}>) {
  const remove = useMutation({
    meta: {
      success: assignment
        ? `${assignment.assigneeName} removed from ${assignment.sectionName}.`
        : undefined,
    },
    mutationFn: (id: string) => api.admin.assignments.remove(id),
    onSuccess: () => {
      onRemoved();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={(open) => !open && onClose()}
      destructive
      title={`Remove ${assignment?.assigneeName ?? ''} from ${assignment?.sectionName ?? ''}?`}
      description="The questions they have already written stay in the bank; only the assignment record is removed."
      confirmLabel="Remove"
      loading={remove.isPending}
      onConfirm={() => assignment && remove.mutate(assignment.id)}
    />
  );
}
