import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PAPER_SOURCES,
  PAPER_SOURCE_LABELS,
  civilDate,
  todayISO,
  type Assignment,
  type AssignmentRole,
  type BaseConfigSection,
  type PaperSource,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FormCombobox,
  FormDialog,
  RadioGroup,
  RadioGroupItem,
  DatePicker,
  plural,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ASSIGNMENT_ROLE_LABELS } from '../../lib/labels';
import { QUERY_KEYS, assignableAdminsQueryKey, testQueryKey } from '../../lib/query-keys';

/** The five dialogs the assign step opens; each owns the one write it makes. */

/** What each source means for the people on it, said beside the choice that fixes it for good. */
const SOURCE_CHOICES = {
  [PAPER_SOURCES.FRAMED]: {
    hint: 'A typist writes each section and a proof-reader checks it before it reaches you.',
  },
  [PAPER_SOURCES.PICKED]: {
    hint: 'You pick each section from the bank; a proof-reader checks it and a typist fixes what they send back.',
  },
} as const;

const SOURCE_ORDER = [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED] as const;

export function SourceDialog({ testId }: Readonly<{ testId: string }>) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [chosen, setChosen] = useState<PaperSource | ''>('');

  const choose = useMutation({
    meta: { success: 'Question source set.' },
    mutationFn: (paperSource: PaperSource) => api.admin.tests.update(testId, { paperSource }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(testQueryKey(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
      setOpen(false);
    },
  });

  return (
    <>
      <EmptyState
        title="No question source yet"
        action={
          <Button type="button" onClick={() => setOpen(true)}>
            Choose question source
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Question source</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Alert variant="warning">
              Chosen once for this test. Nobody can change it afterwards.
            </Alert>
            <RadioGroup
              name="paper-source"
              legend="Question source"
              hideLegend
              value={chosen}
              onValueChange={(next) => setChosen(next as PaperSource)}
              className="grid gap-3"
            >
              {SOURCE_ORDER.map((source) => (
                <RadioGroupItem
                  key={source}
                  id={`paper-source-${source}`}
                  value={source}
                  className="rounded-lg border border-border p-3 has-[input:checked]:border-primary"
                  label={
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">{PAPER_SOURCE_LABELS[source]}</span>
                      <span className="text-sm text-muted-foreground">
                        {SOURCE_CHOICES[source].hint}
                      </span>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={chosen === ''}
              loading={choose.isPending}
              onClick={() => chosen && choose.mutate(chosen)}
            >
              Choose
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A picked section goes to its reader; from then the paper is theirs to read until they release it. */
export function HandOverDialog({
  testId,
  section,
  onClose,
  onHanded,
}: Readonly<{
  testId: string;
  section: BaseConfigSection | null;
  onClose: () => void;
  onHanded: () => void;
}>) {
  const queryClient = useQueryClient();
  const handOver = useMutation({
    meta: { success: `${section?.name ?? 'Section'} handed to its proof-reader.` },
    mutationFn: (sectionId: string) => api.admin.tests.handOverSection(testId, sectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_PAPER });
      // A hand-over moves the test's stamp, which Setup sends back with its next save.
      void queryClient.invalidateQueries({ queryKey: testQueryKey(testId) });
      onHanded();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={section !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Hand ${section?.name ?? 'this section'} to its proof-reader?`}
      description={`Its ${plural(section?.questionCount ?? 0, 'question')} go to the proof-reader to check. You cannot change this section's paper until they release it.`}
      confirmLabel="Hand over"
      loading={handOver.isPending}
      onConfirm={() => section && handOver.mutate(section.id)}
    />
  );
}

interface AssignFormValues {
  assigneeId: string;
  dueAt: string;
}

const ASSIGN_FIELDS = ['assigneeId', 'dueAt'] as const;

export function AssignDialog({
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
  // The server already narrows this to active admins holding the role's feature key.
  const assignable = useQuery({
    queryKey: assignableAdminsQueryKey(role),
    queryFn: () => api.admin.assignments.assignable({ role }),
  });
  const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

  const assign = useMutation({
    meta: { success: `${section.name} assigned to a ${word}.`, fields: ASSIGN_FIELDS },
    mutationFn: (values: AssignFormValues) =>
      api.admin.assignments.assign(testId, {
        baseConfigSectionId: section.id,
        assigneeId: values.assigneeId,
        role,
        dueAt: values.dueAt,
      }),
    onSuccess: () => {
      onAssigned();
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, ASSIGN_FIELDS),
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
        items={(assignable.data ?? []).map((admin) => ({
          value: admin.id,
          label: admin.fullName ?? 'Unnamed admin',
        }))}
        isLoading={assignable.isLoading}
      />

      <Field htmlFor="dueAt" label="Due date" error={form.formState.errors.dueAt?.message}>
        {(control) => (
          <DatePicker
            {...control}
            value={dueAt}
            min={todayISO()}
            onChange={(next) => {
              form.clearErrors('dueAt');
              form.setValue('dueAt', next, { shouldDirty: true });
            }}
          />
        )}
      </Field>
    </FormDialog>
  );
}

interface DueFormValues {
  dueAt: string;
}

const DUE_FIELDS = ['dueAt'] as const;

export function DueDateDialog({
  assignment,
  onClose,
  onChanged,
}: Readonly<{ assignment: Assignment; onClose: () => void; onChanged: () => void }>) {
  const form = useForm<DueFormValues>({
    defaultValues: { dueAt: assignment.dueAt ? civilDate(new Date(assignment.dueAt)) : '' },
  });
  const dueAt = useWatch({ control: form.control, name: 'dueAt' }) ?? '';

  const change = useMutation({
    meta: { success: 'Due date changed.', fields: DUE_FIELDS },
    mutationFn: (values: DueFormValues) =>
      api.admin.assignments.changeDueDate(assignment.testId, assignment.id, {
        dueAt: values.dueAt,
      }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, DUE_FIELDS),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => change.mutate(values)}
      title={`Change ${ASSIGNMENT_ROLE_LABELS[assignment.role].toLowerCase()} due date for ${assignment.sectionName}`}
      submitLabel="Change due date"
      loading={change.isPending}
    >
      <Field htmlFor="dueAt" label="Due date" error={form.formState.errors.dueAt?.message}>
        {(control) => (
          <DatePicker
            {...control}
            value={dueAt}
            min={todayISO()}
            clearable={false}
            onChange={(next) => {
              form.clearErrors('dueAt');
              form.setValue('dueAt', next, { shouldDirty: true });
            }}
          />
        )}
      </Field>
    </FormDialog>
  );
}

export function RemoveDialog({
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
    mutationFn: (row: Assignment) => api.admin.assignments.remove(row.testId, row.id),
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
      onConfirm={() => assignment && remove.mutate(assignment)}
    />
  );
}
