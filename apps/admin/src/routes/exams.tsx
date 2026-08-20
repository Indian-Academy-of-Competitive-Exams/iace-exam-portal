import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  EXAM_FAMILIES,
  createExamSchema,
  updateExamSchema,
  type CreateExamInput,
  type Exam,
  type UpdateExamInput,
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
  Select,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { useExams } from '../lib/use-exams';
import { applyFieldErrors } from '@iace/app-kit';

const NEW_EXAM_FIELDS = ['family', 'name', 'code'] as const;
const EDIT_EXAM_FIELDS = ['family', 'name', 'code'] as const;

const EXAMS_QUERY_KEY = ['admin', 'exams'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function examColumns(
  isSuperAdmin: boolean,
  refresh: () => void,
  onEdit: (exam: Exam) => void,
): DataTableColumn<Exam>[] {
  return [
    { key: 'family', header: 'Family', cell: (exam) => exam.family.replaceAll('_', '/') },
    { key: 'name', header: 'Exam', className: 'font-medium', cell: (exam) => exam.name },
    {
      key: 'code',
      header: 'Code',
      cell: (exam) => <span className="font-mono text-sm">{exam.code}</span>,
    },
    {
      key: 'stages',
      header: 'Stages',
      numeric: true,
      cell: (exam) =>
        exam.stageCount > 0 ? exam.stageCount : <span className="text-muted-foreground">0</span>,
    },
    { key: 'status', header: 'Status', cell: (exam) => <ExamStatus exam={exam} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (exam) => (
        <ExamRowActions exam={exam} canEdit={isSuperAdmin} onChanged={refresh} onEdit={onEdit} />
      ),
    },
  ];
}

/** Anyone managing students may read the catalog, because they pick from it. Only a super admin writes. */
export function ExamsPage() {
  const { identity: admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Exam | null>(null);
  const exams = useExams();
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: EXAMS_QUERY_KEY }),
    [queryClient],
  );

  const startEdit = useCallback((exam: Exam) => {
    setCreating(false);
    setEditing(exam);
  }, []);

  const columns = useMemo(
    () => examColumns(isSuperAdmin, refresh, startEdit),
    [isSuperAdmin, refresh, startEdit],
  );

  const formOpen = creating || editing !== null;

  const header = (
    <>
      <PageHeader
        title="Exams"
        description="The exams the institute coaches for. A student's enrolment is recorded against the code, and every stage, config and test hangs off one of these."
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
              New exam
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <Alert variant="info" className="mb-5">
          <span>
            Only a super admin can add or change an exam. You can see the list to pick from.
          </span>
        </Alert>
      ) : null}

      {creating ? (
        <NewExamCard
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditExamCard
          exam={editing}
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
      {/* No pagination: `useExams` already loads the whole short list. */}
      <DataTable
        columns={columns}
        rows={exams}
        rowKey={(exam) => exam.id}
        isLoading={false}
        empty="No exams yet."
      />
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewExamCard({ onDone, onCancel }: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateExamInput>({
    resolver: zodResolver(createExamSchema),
    defaultValues: { family: EXAM_FAMILIES[0], name: '', code: '' },
  });

  const create = useMutation({
    meta: { success: 'Exam created.', fields: NEW_EXAM_FIELDS },
    mutationFn: (values: CreateExamInput) => api.admin.exams.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_EXAM_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New exam</CardTitle>
        <CardDescription>
          The name is what admins read; the code is what an enrolment stores. Choose the code
          carefully — once any student is enrolled on it, it can no longer be changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="family" label="Family" className="min-w-40">
            {(control) => (
              <Select {...control}>
                {EXAM_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {family.replaceAll('_', '/')}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

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
 * A typo in a code must be fixable before any student is enrolled on it; after that the server
 * refuses (`examEditBlocker`). There is no enrolment count on this row, so the input stays
 * editable and the save is what refuses.
 */
function EditExamCard({
  exam,
  onDone,
  onCancel,
}: Readonly<{ exam: Exam; onDone: () => void; onCancel: () => void }>) {
  const form = useForm<UpdateExamInput>({
    resolver: zodResolver(updateExamSchema),
    defaultValues: { family: exam.family, name: exam.name, code: exam.code },
  });

  const save = useMutation({
    meta: { success: 'Exam saved.', fields: EDIT_EXAM_FIELDS },
    mutationFn: (values: UpdateExamInput) => api.admin.exams.update(exam.id, values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, EDIT_EXAM_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Edit {exam.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <FormField form={form} name="family" label="Family" className="min-w-40">
            {(control) => (
              <Select {...control}>
                {EXAM_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {family.replaceAll('_', '/')}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField form={form} name="name" label="Name" className="min-w-56 flex-1">
            {(control) => <Input {...control} autoFocus />}
          </FormField>

          <FormField
            form={form}
            name="code"
            label="Code"
            className="min-w-40 flex-1"
            hint="Free to change only while no student is enrolled on it — the save is refused after that."
          >
            {(control) => <Input {...control} className="uppercase placeholder:normal-case" />}
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
const EXAM_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type ExamConfirm = (typeof EXAM_CONFIRMS)[keyof typeof EXAM_CONFIRMS];

function ExamStatus({ exam }: Readonly<{ exam: Exam }>) {
  if (exam.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/**
 * The buttons only ask; both dialogs live with the mutations in `ExamRowActions`.
 * A component, not a ternary, because the first state is "render nothing".
 */
function ExamActions({
  exam,
  canEdit,
  busy,
  onAsk,
  onEdit,
}: Readonly<{
  exam: Exam;
  canEdit: boolean;
  busy: boolean;
  onAsk: (confirm: ExamConfirm) => void;
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
        onClick={() => onAsk(EXAM_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {exam.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAsk(EXAM_CONFIRMS.DELETE)}>
        <Trash2 aria-hidden />
        Delete
      </Button>
    </span>
  );
}

function ExamRowActions({
  exam,
  canEdit,
  onChanged,
  onEdit,
}: Readonly<{
  exam: Exam;
  canEdit: boolean;
  onChanged: () => void;
  onEdit: (exam: Exam) => void;
}>) {
  const [asking, setAsking] = useState<ExamConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${exam.name} deleted.` },
    mutationFn: () => api.admin.exams.remove(exam.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${exam.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.exams.update(exam.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <ExamActions
        exam={exam}
        canEdit={canEdit}
        busy={busy}
        onAsk={setAsking}
        onEdit={() => onEdit(exam)}
      />

      <ConfirmDialog
        open={asking === EXAM_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={exam.isActive ? `Retire ${exam.name}?` : `Reactivate ${exam.name}?`}
        description={
          exam.isActive
            ? `Nothing it already holds changes — ${plural(exam.stageCount, 'stage')} and every student enrolled under ${exam.code} keep working exactly as now. What stops is new ones: this exam will no longer be offered when anyone enrols a student. Reactivating puts it back.`
            : 'The exam is offered again on the student form. Nothing else changes.'
        }
        confirmLabel={exam.isActive ? 'Retire exam' : 'Reactivate exam'}
        onConfirm={() => setActive.mutate(!exam.isActive)}
      />

      {/* Deleting is refused server-side while anything still points here, so the
          count decides which of two different questions this is. */}
      <ConfirmDialog
        open={asking === EXAM_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${exam.name}?`}
        description={
          exam.stageCount === 0
            ? `Nothing hangs off ${exam.code}. If a student is still enrolled on it, this will be refused. Deleting cannot be undone.`
            : `${plural(exam.stageCount, 'stage')} still hang off ${exam.code}, and deleting it will be refused. Retire the exam instead — it keeps everything it has and is simply no longer offered.`
        }
        confirmLabel="Delete exam"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
