import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  createExamTypeSchema,
  updateExamTypeSchema,
  type CreateExamTypeInput,
  type ExamType,
  type UpdateExamTypeInput,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  PageHeader,
  plural,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { useExamTypes } from '../lib/use-exam-types';
import { applyFieldErrors } from '@iace/app-kit';

const NEW_EXAM_TYPE_FIELDS = ['name', 'code'] as const;
const EDIT_EXAM_TYPE_FIELDS = ['name', 'code'] as const;

const EXAM_TYPES_QUERY_KEY = ['admin', 'exam-types'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function examTypeColumns(
  isSuperAdmin: boolean,
  refresh: () => void,
  onEdit: (examType: ExamType) => void,
): DataTableColumn<ExamType>[] {
  return [
    { key: 'name', header: 'Exam type', className: 'font-medium', cell: (type) => type.name },
    {
      key: 'code',
      header: 'Code',
      cell: (type) => <span className="font-mono text-sm">{type.code}</span>,
    },
    {
      key: 'groups',
      header: 'Groups',
      numeric: true,
      cell: (type) =>
        type.groupCount > 0 ? type.groupCount : <span className="text-muted-foreground">0</span>,
    },
    { key: 'status', header: 'Status', cell: (type) => <ExamTypeStatus examType={type} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (type) => (
        <ExamTypeRowActions
          examType={type}
          canEdit={isSuperAdmin}
          onChanged={refresh}
          onEdit={onEdit}
        />
      ),
    },
  ];
}

/** Anyone managing groups may read the catalog, because they pick from it. Only a super admin writes. */
export function ExamTypesPage() {
  const { identity: admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ExamType | null>(null);
  const examTypes = useExamTypes();
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: EXAM_TYPES_QUERY_KEY }),
    [queryClient],
  );

  const startEdit = useCallback((examType: ExamType) => {
    setCreating(false);
    setEditing(examType);
  }, []);

  const columns = useMemo(
    () => examTypeColumns(isSuperAdmin, refresh, startEdit),
    [isSuperAdmin, refresh, startEdit],
  );

  const formOpen = creating || editing !== null;

  const header = (
    <>
      <PageHeader
        title="Exam types"
        description="The exams the institute coaches for. Groups and student enrolments are both recorded against the code."
        action={
          isSuperAdmin ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setCreating((open) => !open);
              }}
            >
              <Plus aria-hidden />
              New exam type
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <Alert variant="info" className="mb-5">
          <span>
            Only a super admin can add or change an exam type. You can see the list to pick from.
          </span>
        </Alert>
      ) : null}

      {creating ? (
        <NewExamTypeCard
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditExamTypeCard
          examType={editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </>
  );

  return (
    <TableFrame framed={!formOpen} header={header}>
      {/* No pagination: `useExamTypes` already loads the whole short list. */}
      <DataTable
        columns={columns}
        rows={examTypes}
        rowKey={(type) => type.id}
        isLoading={false}
        empty="No exam types yet."
      />
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewExamTypeCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateExamTypeInput>({
    resolver: zodResolver(createExamTypeSchema),
    defaultValues: { name: '', code: '' },
  });

  const create = useMutation({
    meta: { success: 'Exam type created.', fields: NEW_EXAM_TYPE_FIELDS },
    mutationFn: (values: CreateExamTypeInput) => api.admin.examTypes.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_EXAM_TYPE_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New exam type</CardTitle>
        <CardDescription>
          The name is what admins read; the code is what groups and enrolments store. Choose the
          code carefully — once any group uses it, it can no longer be changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="name" label="Name" className="min-w-56 flex-1">
            {(control) => (
              <Input {...control} placeholder="SSC Combined Graduate Level" autoFocus />
            )}
          </FormField>

          <FormField form={form} name="code" label="Code" className="min-w-40 flex-1">
            {(control) => (
              <Input
                {...control}
                className="uppercase placeholder:normal-case"
                placeholder="SSC CGL"
              />
            )}
          </FormField>

          <FormActions>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * A typo in a code must be fixable before any group carries it; after that the server refuses
 * (`examTypeEditBlocker`). The hint here is belt and braces — disabling the input is not the guarantee.
 */
function EditExamTypeCard({
  examType,
  onDone,
  onCancel,
}: Readonly<{ examType: ExamType; onDone: () => void; onCancel: () => void }>) {
  const form = useForm<UpdateExamTypeInput>({
    resolver: zodResolver(updateExamTypeSchema),
    defaultValues: { name: examType.name, code: examType.code },
  });

  const save = useMutation({
    meta: { success: 'Exam type saved.', fields: EDIT_EXAM_TYPE_FIELDS },
    mutationFn: (values: UpdateExamTypeInput) => api.admin.examTypes.update(examType.id, values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, EDIT_EXAM_TYPE_FIELDS),
  });

  const codeIsFrozen = examType.groupCount > 0;

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Edit {examType.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <FormField form={form} name="name" label="Name" className="min-w-56 flex-1">
            {(control) => <Input {...control} autoFocus />}
          </FormField>

          <FormField
            form={form}
            name="code"
            label="Code"
            className="min-w-40 flex-1"
            hint={
              codeIsFrozen
                ? `${plural(examType.groupCount, 'group')} already carry this code — it can no longer change.`
                : 'Free to change only while no group and no enrolled student uses it yet — this screen only shows the group count, so the save can still be refused.'
            }
          >
            {(control) => (
              <Input
                {...control}
                disabled={codeIsFrozen}
                className="uppercase placeholder:normal-case"
              />
            )}
          </FormField>

          <FormActions>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** One question at a time: two booleans could render two dialogs at once. */
const EXAM_TYPE_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type ExamTypeConfirm = (typeof EXAM_TYPE_CONFIRMS)[keyof typeof EXAM_TYPE_CONFIRMS];

function ExamTypeStatus({ examType }: Readonly<{ examType: ExamType }>) {
  if (examType.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/**
 * The buttons only ask; both dialogs live with the mutations in `ExamTypeRowActions`.
 * A component, not a ternary, because the first state is "render nothing".
 */
function ExamTypeActions({
  examType,
  canEdit,
  busy,
  onAsk,
  onEdit,
}: Readonly<{
  examType: ExamType;
  canEdit: boolean;
  busy: boolean;
  onAsk: (confirm: ExamTypeConfirm) => void;
  onEdit: () => void;
}>) {
  if (!canEdit) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
        <Pencil aria-hidden />
        Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(EXAM_TYPE_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {examType.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onAsk(EXAM_TYPE_CONFIRMS.DELETE)}
      >
        <Trash2 aria-hidden />
        Delete
      </Button>
    </span>
  );
}

function ExamTypeRowActions({
  examType,
  canEdit,
  onChanged,
  onEdit,
}: Readonly<{
  examType: ExamType;
  canEdit: boolean;
  onChanged: () => void;
  onEdit: (examType: ExamType) => void;
}>) {
  const [asking, setAsking] = useState<ExamTypeConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${examType.name} deleted.` },
    mutationFn: () => api.admin.examTypes.remove(examType.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${examType.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.examTypes.update(examType.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <ExamTypeActions
        examType={examType}
        canEdit={canEdit}
        busy={busy}
        onAsk={setAsking}
        onEdit={() => onEdit(examType)}
      />

      <ConfirmDialog
        open={asking === EXAM_TYPE_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={examType.isActive ? `Retire ${examType.name}?` : `Reactivate ${examType.name}?`}
        description={
          examType.isActive
            ? `Nothing it already holds changes — ${plural(examType.groupCount, 'group')} and every student enrolled under ${examType.code} keep working exactly as now. What stops is new ones: this exam type will no longer be offered when anyone creates a group or enrols a student. Reactivating puts it back.`
            : 'The exam type is offered again on the group and student forms. Nothing else changes.'
        }
        confirmLabel={examType.isActive ? 'Retire exam type' : 'Reactivate exam type'}
        onConfirm={() => setActive.mutate(!examType.isActive)}
      />

      {/* Deleting is refused server-side while anything still points here, so the
          count decides which of two different questions this is. */}
      <ConfirmDialog
        open={asking === EXAM_TYPE_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${examType.name}?`}
        description={
          examType.groupCount === 0
            ? `Nothing points at ${examType.code} from the groups list. If a base config, a test or an enrolled student still does, this will be refused. Deleting cannot be undone.`
            : `${plural(examType.groupCount, 'group')} still use ${examType.code}, and deleting it will be refused. Retire the exam type instead — it keeps everything it has and is simply no longer offered.`
        }
        confirmLabel="Delete exam type"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
