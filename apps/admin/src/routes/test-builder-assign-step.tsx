import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  scopedSections,
  instituteDayLabel,
  type Assignment,
  type AssignmentRole,
  type BaseConfigDetail,
  type BaseConfigSection,
  type TestDetail,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Alert,
  Badge,
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
  TruncatedText,
  DatePicker,
  type BadgeProps,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { ASSIGNMENT_ROLE_LABELS, QUERY_KEYS } from '../lib/constants';

/** Sits beside the paper it staffs: who types and reads each section, before the paper is judged. */

const ROLE_ORDER = [ASSIGNMENT_ROLES.TYPIST, ASSIGNMENT_ROLES.PROOFREADER] as const;

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

  return (
    <FormSection title="Assignments">
      {outstanding ? (
        <Alert variant="info">
          A test cannot be offered until every section is typed and read.
        </Alert>
      ) : null}

      <DataTable
        columns={columnsOf(setAssigning, setRemoving)}
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
    </FormSection>
  );
}

function columnsOf(
  onAssign: (target: AssignTarget) => void,
  onRemove: (assignment: Assignment) => void,
): DataTableColumn<SectionRow>[] {
  return [
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
      cell: (row) => <RoleCell assignment={row.typist} questionCount={row.section.questionCount} />,
    },
    {
      key: 'proofreader',
      header: 'Proof-reader',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <RoleCell assignment={row.proofreader} questionCount={row.section.questionCount} />
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => (
        <RowActions label={`Actions for ${row.section.name}`}>
          {actionItemsFor(row, onAssign, onRemove)}
        </RowActions>
      ),
    },
  ];
}

function actionItemsFor(
  row: SectionRow,
  onAssign: (target: AssignTarget) => void,
  onRemove: (assignment: Assignment) => void,
): ReactNode[] {
  const items: ReactNode[] = [];
  for (const role of ROLE_ORDER) {
    const assignment = role === ASSIGNMENT_ROLES.TYPIST ? row.typist : row.proofreader;
    const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

    if (!assignment) {
      items.push(
        <DropdownMenuItem key={role} onSelect={() => onAssign({ section: row.section, role })}>
          Assign {word}
        </DropdownMenuItem>,
      );
    } else if (!assignment.finalizedAt) {
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
}: Readonly<{ assignment: Assignment | undefined; questionCount: number }>) {
  if (!assignment) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
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
