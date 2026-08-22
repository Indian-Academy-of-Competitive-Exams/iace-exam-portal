import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  EXAM_FAMILIES,
  EXAM_MODES,
  STAGE_DISPOSITIONS,
  createExamSchema,
  createExamStageSchema,
  updateExamSchema,
  updateExamStageSchema,
  type CreateExamInput,
  type CreateExamStageInput,
  type Exam,
  type ExamFamily,
  type ExamMode,
  type ExamStage,
  type StageDisposition,
  type UpdateExamInput,
  type UpdateExamStageInput,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FilterBar,
  FormDialog,
  FormField,
  Input,
  NumericInput,
  PageHeader,
  Pagination,
  plural,
  RowActions,
  SearchInput,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { familyLabel, NAV_ITEMS } from '../lib/constants';
import { useFilters } from '../lib/use-filters';
import { ExamPicker } from '../components/exam-picker';
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';

const NEW_EXAM_FIELDS = ['family', 'name', 'code'] as const;
const EDIT_EXAM_FIELDS = ['family', 'name', 'code'] as const;

/** AP_TS_POLICE reads as AP/TS POLICE — the underscore is a Prisma enum's constraint, not a name. */
/** Built outside the component: `cell` is a render prop, not a component declaration. */
function examColumns(
  isSuperAdmin: boolean,
  refresh: () => void,
  onEdit: (exam: Exam) => void,
): DataTableColumn<Exam>[] {
  return [
    { key: 'family', header: 'Family', cell: (exam) => familyLabel(exam.family) },
    {
      key: 'name',
      header: 'Exam',
      className: 'max-w-[18rem] font-medium',
      cell: (exam) => <TruncatedText>{exam.name}</TruncatedText>,
    },
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

/** Every filter the bar can clear. Two controls, so nothing folds. */
const ALL_FILTERS = ['q', 'family'] as const;

const EXAMS_KEY = ['admin', 'exams'] as const;
const STAGES_KEY = ['admin', 'exam-stages'] as const;

/** Anyone managing students may read the catalog, because they pick from it. Only a super admin writes. */
export function ExamsPage() {
  const { identity: admin } = useAuth();
  const canWrite = admin?.isSuperAdmin ?? false;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Exam | null>(null);
  const queryClient = useQueryClient();
  const filters = useFilters<'q' | 'family'>();
  const family = filters.get('family');

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
  }, [queryClient]);

  const startEdit = useCallback((exam: Exam) => {
    setCreating(false);
    setEditing(exam);
  }, []);

  const columns = useMemo(
    () => examColumns(canWrite, refresh, startEdit),
    [canWrite, refresh, startEdit],
  );

  const exams = useListQuery({
    queryKey: EXAMS_KEY,
    filters: {
      q: filters.get('q') || undefined,
      family: (family || undefined) as Exam['family'] | undefined,
    },
    fetchPage: (params) => api.admin.exams.list(params),
  });

  const header = (
    <>
      <PageHeader
        breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
        title="Exams"
        action={
          canWrite ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              <Plus aria-hidden />
              New exam
            </Button>
          ) : undefined
        }
      />

      {!canWrite ? (
        <Alert variant="info" className="mb-4">
          <span>
            Only a super admin can add or change the catalog. You can see it to pick from.
          </span>
        </Alert>
      ) : null}
    </>
  );

  const toolbar = (
    <FilterBar activeCount={filters.activeCount(ALL_FILTERS)} onClear={() => filters.clear()}>
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search exams"
          placeholder="Search exams"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>

      <div className="w-44">
        <Combobox
          aria-label="Filter by family"
          clearable={false}
          value={family}
          onChange={(next) => filters.set({ family: next })}
          items={[
            { value: '', label: 'Any family' },
            ...EXAM_FAMILIES.map((value) => ({ value, label: familyLabel(value) })),
          ]}
        />
      </div>
    </FilterBar>
  );

  return (
    <TableFrame header={header} toolbar={toolbar}>
      <NewExamDialog
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
      />

      {/* Keyed and mounted only while editing, so its defaults are the row that was clicked. */}
      {editing ? (
        <EditExamDialog
          key={editing.id}
          exam={editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <DataTable
        columns={columns}
        rows={exams.items}
        rowKey={(exam) => exam.id}
        isLoading={exams.isLoading}
        empty="No exams yet. Add the first one — every stage hangs off it."
        expand={{
          render: (exam) => <ExamStages exam={exam} canWrite={canWrite} />,
          label: (exam) => `Show the stages under ${exam.name}`,
        }}
        footer={exams.hasLoaded ? <Pagination {...exams.pagination} /> : null}
      />
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewExamDialog({
  open,
  onOpenChange,
  onDone,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }>) {
  const form = useForm<CreateExamInput>({
    resolver: zodResolver(createExamSchema),
    defaultValues: { family: EXAM_FAMILIES[0], name: '', code: '' },
  });

  const chosenFamily = useWatch({ control: form.control, name: 'family' }) ?? EXAM_FAMILIES[0]!;

  const create = useMutation({
    meta: { success: 'Exam created.', fields: NEW_EXAM_FIELDS },
    mutationFn: (values: CreateExamInput) => api.admin.exams.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_EXAM_FIELDS),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New exam"
      submitLabel="Create"
      loading={create.isPending}
    >
      <FormField form={form} name="family" label="Family">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={chosenFamily}
            onChange={(next) => form.setValue('family', next as ExamFamily, { shouldDirty: true })}
            items={EXAM_FAMILIES.map((value) => ({ value, label: familyLabel(value) }))}
          />
        )}
      </FormField>

      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} placeholder="SSC Combined Graduate Level" autoFocus />}
      </FormField>

      <FormField form={form} name="code" label="Code">
        {(control) => (
          <Input {...control} className="uppercase placeholder:normal-case" placeholder="SSC CGL" />
        )}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

/**
 * A typo in a code must be fixable before any student is enrolled on it; after that the server
 * refuses (`examEditBlocker`). There is no enrolment count on this row, so the input stays
 * editable and the save is what refuses.
 */
function EditExamDialog({
  exam,
  onDone,
  onClose,
}: Readonly<{ exam: Exam; onDone: () => void; onClose: () => void }>) {
  const form = useForm<UpdateExamInput>({
    resolver: zodResolver(updateExamSchema),
    defaultValues: { family: exam.family, name: exam.name, code: exam.code },
  });

  const chosenFamily = useWatch({ control: form.control, name: 'family' }) ?? exam.family;

  const save = useMutation({
    meta: { success: 'Exam saved.', fields: EDIT_EXAM_FIELDS },
    mutationFn: (values: UpdateExamInput) => api.admin.exams.update(exam.id, values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, EDIT_EXAM_FIELDS),
  });

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      form={form}
      onSubmit={(values) => save.mutate(values)}
      title={`Edit ${exam.name}`}
      submitLabel="Save"
      loading={save.isPending}
    >
      <FormField form={form} name="family" label="Family">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={chosenFamily}
            onChange={(next) => form.setValue('family', next as ExamFamily, { shouldDirty: true })}
            items={EXAM_FAMILIES.map((value) => ({ value, label: familyLabel(value) }))}
          />
        )}
      </FormField>

      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} autoFocus />}
      </FormField>

      <FormField form={form} name="code" label="Code" hint="Locked once a student is enrolled">
        {(control) => <Input {...control} className="uppercase placeholder:normal-case" />}
      </FormField>
    </FormDialog>
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
  return (
    <RowActions label={`Actions for ${exam.name}`}>
      {canEdit ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onSelect={onEdit}>
            <Pencil aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => onAsk(EXAM_CONFIRMS.RETIRE)}>
            <Power aria-hidden />
            {exam.isActive ? 'Retire' : 'Reactivate'}
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            disabled={busy}
            onSelect={() => onAsk(EXAM_CONFIRMS.DELETE)}
          >
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        </>
      ) : null}
    </RowActions>
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

// ============================================================================
// Stages
// ============================================================================

const NEW_STAGE_FIELDS = ['examId', 'stageKey', 'name', 'order'] as const;
const EDIT_STAGE_FIELDS = ['stageKey', 'name', 'order'] as const;

/** What each disposition means for a stage — the difference between a mock and a listing. */
const DISPOSITION_LABELS: Readonly<Record<(typeof STAGE_DISPOSITIONS)[number], string>> = {
  CONDUCTED: 'Conducted',
  PARTIAL: 'Partly conducted',
  CATALOG_ONLY: 'Listed only',
};

const DISPOSITION_VARIANT = {
  CONDUCTED: 'success',
  PARTIAL: 'info',
  CATALOG_ONLY: 'neutral',
} as const;

function stageColumns(
  canWrite: boolean,
  refresh: () => void,
  onEdit: (stage: ExamStage) => void,
): DataTableColumn<ExamStage>[] {
  return [
    { key: 'order', header: '#', numeric: true, cell: (stage) => stage.order },
    {
      key: 'name',
      header: 'Stage',
      className: 'max-w-[16rem] font-medium',
      cell: (stage) => <TruncatedText>{stage.name}</TruncatedText>,
    },
    {
      key: 'stageKey',
      header: 'Key',
      cell: (stage) => <span className="font-mono text-sm">{stage.stageKey}</span>,
    },
    { key: 'mode', header: 'Mode', cell: (stage) => <Badge variant="neutral">{stage.mode}</Badge> },
    {
      key: 'disposition',
      header: 'Runs as',
      cell: (stage) => (
        <Badge variant={DISPOSITION_VARIANT[stage.disposition]}>
          {DISPOSITION_LABELS[stage.disposition]}
        </Badge>
      ),
    },
    { key: 'configs', header: 'Configurations', numeric: true, cell: (stage) => stage.configCount },
    { key: 'status', header: 'Status', cell: (stage) => <StageStatus stage={stage} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (stage) => (
        <StageRowActions stage={stage} canEdit={canWrite} onChanged={refresh} onEdit={onEdit} />
      ),
    },
  ];
}

/** The stages of ONE exam, under its row. The exam is the context, so it is not a column here. */
function ExamStages({ exam, canWrite }: Readonly<{ exam: Exam; canWrite: boolean }>) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ExamStage | null>(null);
  const queryClient = useQueryClient();
  const examId = exam.id;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: STAGES_KEY });
    void queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
  }, [queryClient]);

  const startEdit = useCallback((stage: ExamStage) => {
    setCreating(false);
    setEditing(stage);
  }, []);

  const columns = useMemo(
    () => stageColumns(canWrite, refresh, startEdit),
    [canWrite, refresh, startEdit],
  );

  // Keyed by the exam, so opening a second row does not read the first one's page.
  const stages = useListQuery({
    queryKey: [...STAGES_KEY, examId],
    filters: { examId },
    fetchPage: (params) => api.admin.examStages.list(params),
  });

  return (
    <div className="flex flex-col gap-3">
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            New stage
          </Button>
        </div>
      ) : null}

      <NewStageDialog
        examId={examId}
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
      />

      {/* Keyed and mounted only while editing, so its defaults are the row that was clicked. */}
      {editing ? (
        <EditStageDialog
          key={editing.id}
          stage={editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <DataTable
        columns={columns}
        rows={stages.items}
        rowKey={(stage) => stage.id}
        isLoading={stages.isLoading}
        empty="No stages here yet. A base config, a series and a test all hang off one."
        footer={
          // An exam has a handful of stages, so this appears only if one page cannot hold them.
          stages.pagination.total > stages.pagination.pageSize ? (
            <Pagination {...stages.pagination} />
          ) : null
        }
      />
    </div>
  );
}

function StageStatus({ stage }: Readonly<{ stage: ExamStage }>) {
  if (stage.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

function NewStageDialog({
  examId,
  open,
  onOpenChange,
  onDone,
}: Readonly<{
  examId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}>) {
  const form = useForm<CreateExamStageInput>({
    resolver: zodResolver(createExamStageSchema),
    // Seeded from the filter: adding stages to the exam you are looking at is the normal case.
    defaultValues: { examId, stageKey: '', name: '', order: 0 },
  });
  const chosenExam = useWatch({ control: form.control, name: 'examId' }) ?? '';

  const chosenMode = useWatch({ control: form.control, name: 'mode' }) ?? EXAM_MODES[0]!;
  const chosenDisposition =
    useWatch({ control: form.control, name: 'disposition' }) ?? STAGE_DISPOSITIONS[0]!;

  const create = useMutation({
    meta: { success: 'Stage added.', fields: NEW_STAGE_FIELDS },
    mutationFn: (values: CreateExamStageInput) => api.admin.examStages.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_STAGE_FIELDS),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New stage"
      submitLabel="Add stage"
      loading={create.isPending}
    >
      <FormField form={form} name="examId" label="Exam">
        {(control) => (
          <ExamPicker
            id={control.id}
            value={chosenExam}
            placeholder="Choose an exam"
            onChange={(value) => form.setValue('examId', value, { shouldValidate: true })}
          />
        )}
      </FormField>

      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} placeholder="Tier 1" autoFocus />}
      </FormField>

      <FormField form={form} name="stageKey" label="Key">
        {(control) => (
          <Input
            {...control}
            className="uppercase placeholder:normal-case"
            placeholder="SSC_CGL_T1"
          />
        )}
      </FormField>

      <FormField form={form} name="order" label="Order" hint="Lowest first">
        {(control) => <NumericInput {...control} {...form.register('order')} />}
      </FormField>

      <FormField form={form} name="mode" label="Mode">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={chosenMode}
            onChange={(next) => form.setValue('mode', next as ExamMode, { shouldDirty: true })}
            items={EXAM_MODES.map((mode) => ({ value: mode, label: mode }))}
          />
        )}
      </FormField>

      <FormField form={form} name="disposition" label="Runs as">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={chosenDisposition}
            onChange={(next) =>
              form.setValue('disposition', next as StageDisposition, { shouldDirty: true })
            }
            items={STAGE_DISPOSITIONS.map((value) => ({
              value,
              label: DISPOSITION_LABELS[value],
            }))}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

/** A stage never moves exam, so the exam is stated here rather than offered. */
function EditStageDialog({
  stage,
  onDone,
  onClose,
}: Readonly<{ stage: ExamStage; onDone: () => void; onClose: () => void }>) {
  const form = useForm<UpdateExamStageInput>({
    resolver: zodResolver(updateExamStageSchema),
    defaultValues: {
      stageKey: stage.stageKey,
      name: stage.name,
      order: stage.order,
      mode: stage.mode,
      disposition: stage.disposition,
    },
  });

  const chosenMode = useWatch({ control: form.control, name: 'mode' }) ?? EXAM_MODES[0]!;
  const chosenDisposition =
    useWatch({ control: form.control, name: 'disposition' }) ?? STAGE_DISPOSITIONS[0]!;

  const save = useMutation({
    meta: { success: 'Stage saved.', fields: EDIT_STAGE_FIELDS },
    mutationFn: (values: UpdateExamStageInput) => api.admin.examStages.update(stage.id, values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, EDIT_STAGE_FIELDS),
  });

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      form={form}
      onSubmit={(values) => save.mutate(values)}
      title={`Edit ${stage.exam.code} / ${stage.name}`}
      submitLabel="Save"
      loading={save.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} autoFocus />}
      </FormField>

      <FormField
        form={form}
        name="stageKey"
        label="Key"
        hint={
          stage.configCount > 0
            ? `${plural(stage.configCount, 'base configuration')} hangs off this key — it can no longer change.`
            : 'Free to change only while no base configuration hangs off it.'
        }
      >
        {(control) => (
          <Input
            {...control}
            disabled={stage.configCount > 0}
            className="uppercase placeholder:normal-case"
          />
        )}
      </FormField>

      <FormField form={form} name="order" label="Order" hint="Lowest first">
        {(control) => <NumericInput {...control} {...form.register('order')} />}
      </FormField>

      <FormField form={form} name="mode" label="Mode">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={chosenMode}
            onChange={(next) => form.setValue('mode', next as ExamMode, { shouldDirty: true })}
            items={EXAM_MODES.map((mode) => ({ value: mode, label: mode }))}
          />
        )}
      </FormField>

      <FormField form={form} name="disposition" label="Runs as">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={chosenDisposition}
            onChange={(next) =>
              form.setValue('disposition', next as StageDisposition, { shouldDirty: true })
            }
            items={STAGE_DISPOSITIONS.map((value) => ({
              value,
              label: DISPOSITION_LABELS[value],
            }))}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

function StageRowActions({
  stage,
  canEdit,
  onChanged,
  onEdit,
}: Readonly<{
  stage: ExamStage;
  canEdit: boolean;
  onChanged: () => void;
  onEdit: (stage: ExamStage) => void;
}>) {
  const [asking, setAsking] = useState<ExamConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${stage.name} deleted.` },
    mutationFn: () => api.admin.examStages.remove(stage.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${stage.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.examStages.update(stage.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  if (!canEdit) return null;

  return (
    <>
      <RowActions label={`Actions for ${stage.name}`}>
        <DropdownMenuItem disabled={busy} onSelect={() => onEdit(stage)}>
          <Pencil aria-hidden />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => setAsking(EXAM_CONFIRMS.RETIRE)}>
          <Power aria-hidden />
          {stage.isActive ? 'Retire' : 'Reactivate'}
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          disabled={busy}
          onSelect={() => setAsking(EXAM_CONFIRMS.DELETE)}
        >
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </RowActions>

      <ConfirmDialog
        open={asking === EXAM_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={stage.isActive ? `Retire ${stage.name}?` : `Reactivate ${stage.name}?`}
        description={
          stage.isActive
            ? `Nothing it already holds changes — ${plural(stage.configCount, 'base configuration')} and ${plural(stage.testCount, 'test')} keep working exactly as now. What stops is new ones: this stage will no longer be offered when anyone builds a configuration, a series or a test. Reactivating puts it back.`
            : 'The stage is offered again when anyone builds a configuration, a series or a test. Nothing else changes.'
        }
        confirmLabel={stage.isActive ? 'Retire stage' : 'Reactivate stage'}
        onConfirm={() => setActive.mutate(!stage.isActive)}
      />

      {/* Deleting is refused server-side while anything still hangs off the stage, so the
          counts decide which of two different questions this is. */}
      <ConfirmDialog
        open={asking === EXAM_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${stage.exam.code} / ${stage.name}?`}
        description={
          stage.configCount + stage.testCount + stage.seriesCount === 0
            ? `Nothing hangs off ${stage.stageKey}. Deleting cannot be undone.`
            : `${plural(stage.configCount, 'base configuration')}, ${plural(stage.testCount, 'test')} and ${plural(stage.seriesCount, 'series', 'series')} still hang off ${stage.stageKey}, and deleting it will be refused. Retire the stage instead — it keeps everything it has and is simply no longer offered.`
        }
        confirmLabel="Delete stage"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
