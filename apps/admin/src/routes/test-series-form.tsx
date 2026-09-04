import { useState } from 'react';
import { Clock, Pencil, Power, Trash2, Upload } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  type BranchTestConfigRow,
  type CreateTestSeriesBody,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type SeriesTestRow,
  TEST_SERIES_KIND,
  TEST_SERIES_KINDS,
  type TestSeriesKind,
  type TestSeriesSummary,
  fromInstituteWallTime,
  instituteWallTime,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DataTable,
  DateTimePicker,
  DropdownMenuItem,
  FormDialog,
  FormField,
  FormPanel,
  FormSection,
  Input,
  PageHeader,
  plural,
  RowActions,
  Skeleton,
  SkeletonParagraph,
  StatRow,
  Textarea,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  NAV_ITEMS,
  QUERY_KEYS,
  ROUTES,
  TEST_SERIES_KIND_HINTS,
  TEST_SERIES_KIND_LABELS,
} from '../lib/constants';
import { useSuggestedSeriesName } from '../lib/use-suggested-name';
import { opensLabel } from '../lib/schedule-format';
import { useAuth } from '../providers/auth';
import { ExamStagePicker, type StageChoice } from '../components/exam-picker';
import { EventPicker, ProgramPicker } from '../components/access-picker';

/**
 * One series: who it is for, and — once it exists — which branches run it. The two are separate
 * permissions, so the scheduling card can be read-only on the same screen the rest is editable.
 */

interface SeriesFormValues {
  name: string;
  description: string;
  examStageId: string;
  programCode: string;
  eventId: string;
  sequentialTests: boolean;
  progressive: boolean;
  kind: TestSeriesKind;
}

const seriesKey = (id: string) => [...QUERY_KEYS.TEST_SERIES, id] as const;
const branchesKey = (id: string) => [...QUERY_KEYS.TEST_SERIES, id, 'branches'] as const;

/** Every path the server can name that this form registers, so a failure lands on its own input. */
const SERVER_FIELDS = [
  'name',
  'description',
  'examStageId',
  'programCode',
  'eventId',
  'kind',
] as const;

const KIND_ITEMS = TEST_SERIES_KINDS.map((value) => ({
  value,
  label: TEST_SERIES_KIND_LABELS[value],
  hint: TEST_SERIES_KIND_HINTS[value],
}));

/** A program and an event each belong to one kind, so both leave with the kind that carried them. */
function chooseKind(form: UseFormReturn<SeriesFormValues>, next: TestSeriesKind): void {
  form.setValue('kind', next, { shouldDirty: true });
  if (next !== TEST_SERIES_KIND.PROGRAM) form.setValue('programCode', '', { shouldDirty: true });
  if (next !== TEST_SERIES_KIND.EVENT) form.setValue('eventId', '', { shouldDirty: true });
}

/** The one target its kind requires, which is why exactly one of these is ever on screen. */
function KindTarget({
  form,
  detail,
  kind,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  detail: TestSeriesSummary | null;
  kind: TestSeriesKind;
}>) {
  const programCode = useWatch({ control: form.control, name: 'programCode' });
  const eventId = useWatch({ control: form.control, name: 'eventId' });

  if (kind === TEST_SERIES_KIND.PROGRAM) {
    return (
      <FormField form={form} name="programCode" label="Program">
        {(control) => (
          <ProgramPicker
            id={control.id}
            value={programCode}
            clearable={false}
            placeholder="Choose a program"
            selectedLabel={detail?.programCode ?? undefined}
            onChange={(value) => form.setValue('programCode', value, { shouldDirty: true })}
          />
        )}
      </FormField>
    );
  }

  if (kind === TEST_SERIES_KIND.EVENT) {
    return (
      <FormField form={form} name="eventId" label="Event">
        {(control) => (
          <EventPicker
            id={control.id}
            value={eventId}
            clearable={false}
            placeholder="Choose an event"
            onChange={(value) => form.setValue('eventId', value, { shouldDirty: true })}
          />
        )}
      </FormField>
    );
  }

  return null;
}

/** Who the series is for. Every field follows the kind, so no admin can assemble a refused save. */
function SeriesAccess({
  form,
  detail,
  onPickStage,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  detail: TestSeriesSummary | null;
  onPickStage: (chosen: StageChoice | null) => void;
}>) {
  const kind = useWatch({ control: form.control, name: 'kind' });
  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const spansACourse = kind === TEST_SERIES_KIND.FREE;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField form={form} name="kind" label="Kind">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={kind}
            onChange={(next) => chooseKind(form, next as TestSeriesKind)}
            items={KIND_ITEMS}
          />
        )}
      </FormField>

      <FormField
        form={form}
        name="examStageId"
        label="Stage"
        /* ui-copy-ok: rule */ hint={
          spansACourse ? 'Optional' : 'Only a free series goes without one'
        }
      >
        {(control) => (
          <ExamStagePicker
            id={control.id}
            value={examStageId}
            clearable={spansACourse}
            selectedLabel={
              detail?.examStage
                ? `${detail.examStage.examCode} / ${detail.examStage.name}`
                : undefined
            }
            placeholder={spansACourse ? 'Any stage' : 'Choose a stage'}
            onPick={onPickStage}
            onChange={(value) => form.setValue('examStageId', value, { shouldDirty: true })}
          />
        )}
      </FormField>

      <KindTarget form={form} detail={detail} kind={kind} />

      {detail ? (
        <div className="sm:col-span-2">
          <SeriesSwitch series={detail} />
        </div>
      ) : null}
    </div>
  );
}

/** Turning it on and turning it off are not the same question, so they are not the same words. */
function switchQuestion(
  series: TestSeriesSummary,
  next: boolean,
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const tests = plural(series.testCount, 'test');

  if (next) {
    return {
      title: `Switch ${series.name} on?`,
      description: `Everyone its kind reaches can start its ${tests} from now on. Which students that is comes from the kind; this switch decides whether any of them may sit anything at all.`,
      confirmLabel: 'Switch it on',
      destructive: false,
    };
  }

  return {
    title: `Switch ${series.name} off?`,
    description: `It reaches nobody while it is off, and its ${tests} leave every student's list at once. Attempts already made and their results are kept, and a test somebody is sitting right now is not stopped.`,
    confirmLabel: 'Switch it off',
    destructive: true,
  };
}

/** The master switch. It changes who can sit a test, so it asks in both directions. */
function SeriesSwitch({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<boolean | null>(null);

  const save = useMutation({
    meta: { success: `${series.name} saved.` },
    mutationFn: (isEnabled: boolean) => api.admin.testSeries.update(series.id, { isEnabled }),
    onSuccess: (saved) => {
      setAsking(null);
      queryClient.setQueryData(seriesKey(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
    },
    // Drop out of the confirm on failure, or the row is left asking a question already answered.
    onError: () => setAsking(null),
  });

  const question = switchQuestion(series, asking ?? !series.isEnabled);

  return (
    <>
      <Checkbox
        checked={series.isEnabled}
        disabled={save.isPending}
        onChange={(event) => setAsking(event.target.checked)}
        label="Enabled"
        /* ui-copy-ok: consequence */ hint="Off reaches nobody, whatever the kind"
      />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        destructive={question.destructive}
        loading={save.isPending}
        title={question.title}
        description={question.description}
        confirmLabel={question.confirmLabel}
        onConfirm={() => asking !== null && save.mutate(asking)}
      />
    </>
  );
}

function valuesOf(detail: TestSeriesSummary | null): SeriesFormValues {
  return {
    name: detail?.name ?? '',
    description: detail?.description ?? '',
    examStageId: detail?.examStageId ?? '',
    programCode: detail?.programCode ?? '',
    eventId: detail?.eventId ?? '',
    sequentialTests: detail?.sequentialTests ?? false,
    progressive: detail?.progressive ?? false,
    kind: detail?.kind ?? TEST_SERIES_KIND.STANDARD,
  };
}

/** An empty picker means "no choice", which the API expresses as null. */
function bodyOf(values: SeriesFormValues): CreateTestSeriesBody {
  return {
    name: values.name,
    description: values.description.trim(),
    examStageId: values.examStageId || null,
    // Each target belongs to one kind, so the field it came from cannot outlive that kind.
    programCode: values.kind === TEST_SERIES_KIND.PROGRAM ? values.programCode || null : null,
    eventId: values.kind === TEST_SERIES_KIND.EVENT ? values.eventId || null : null,
    sequentialTests: values.sequentialTests,
    progressive: values.progressive,
    kind: values.kind,
  };
}

export function TestSeriesFormPage() {
  const { id } = useParams();
  const existing = id !== undefined;
  const seriesId = id ?? '';

  const series = useQuery({
    queryKey: seriesKey(seriesId),
    queryFn: () => api.admin.testSeries.detail(seriesId),
    enabled: existing,
  });

  // The form has a known shape, so it is drawn and held rather than spun at.
  if (existing && series.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={9} />
        </Card>
      </div>
    );
  }

  if (existing && (series.error || !series.data)) {
    return <Alert variant="danger">Could not load this series.</Alert>;
  }

  // Mounted only once the saved series is here, so a refetch cannot throw away a half-typed edit.
  return <SeriesEditor detail={series.data ?? null} />;
}

/** What a series you are only READING offers: its candidate import, and the way into editing it. */
function SeriesReadActions({
  series,
  onEdit,
}: Readonly<{ series: TestSeriesSummary | null; onEdit: () => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {series ? (
        <Button variant="outline" size="sm" asChild>
          <Link to={ROUTES.SERIES_CANDIDATES(series.id)}>
            <Upload aria-hidden />
            Import candidates
          </Link>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil aria-hidden />
        Edit series
      </Button>
    </div>
  );
}

function SeriesEditActions({
  existing,
  saving,
  onCancel,
}: Readonly<{ existing: boolean; saving: boolean; onCancel: () => void }>) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" loading={saving}>
        {existing ? 'Save series' : 'Create series'}
      </Button>
    </>
  );
}

function seriesTitle(detail: TestSeriesSummary | null, isEditing: boolean): string {
  if (!detail) return 'New test series';
  return isEditing ? `Edit ${detail.name}` : detail.name;
}

function SeriesEditor({ detail }: Readonly<{ detail: TestSeriesSummary | null }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  // A new series opens ready to type; one that already exists opens read-only.
  const [isEditing, setIsEditing] = useState(!existing);

  const form = useForm<SeriesFormValues>({ defaultValues: valuesOf(detail) });

  const save = useMutation({
    meta: { success: existing ? 'Series saved.' : 'Series created.', fields: SERVER_FIELDS },
    mutationFn: (values: SeriesFormValues) =>
      detail
        ? api.admin.testSeries.update(detail.id, bodyOf(values))
        : api.admin.testSeries.create(bodyOf(values)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
      queryClient.setQueryData(seriesKey(saved.id), saved);
      // A new series is switched off at every branch, so the next step is always
      // the scheduling card — which only exists once it has been created.
      navigate(existing ? ROUTES.TEST_SERIES : ROUTES.TEST_SERIES_DETAIL(saved.id));
    },
    onError: (error) => applyFieldErrors(error, form.setError, SERVER_FIELDS),
  });

  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const programCode = useWatch({ control: form.control, name: 'programCode' });
  const name = useWatch({ control: form.control, name: 'name' });
  const kind = useWatch({ control: form.control, name: 'kind' });

  // The picker hands back only an id, so what the stage is CALLED has to be kept as it is chosen.
  const [stage, setStage] = useState<StageChoice | null>(
    detail?.examStage
      ? { examCode: detail.examStage.examCode, stageName: detail.examStage.name }
      : null,
  );
  const suggested = useSuggestedSeriesName({
    examCode: stage?.examCode,
    stageName: stage?.stageName,
    examStageId: examStageId || undefined,
    programCode,
    kind,
  });
  const banner = bannerMessage(save.error, SERVER_FIELDS);

  /** A new series has nowhere to fall back to, so Cancel leaves; an existing one returns to itself. */
  const cancel = () => {
    if (!existing) return navigate(ROUTES.TEST_SERIES);
    form.reset();
    setIsEditing(false);
  };

  const title = seriesTitle(detail, isEditing);

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        isEditing ? (
          <SeriesEditActions existing={existing} saving={save.isPending} onCancel={cancel} />
        ) : undefined
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={existing ? [{ label: title }] : []} />}
            title={title}
            action={
              isEditing ? undefined : (
                <SeriesReadActions series={detail} onEdit={() => setIsEditing(true)} />
              )
            }
          />

          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    >
      <FormSection title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField form={form} name="name" label="Name">
            {(control) => (
              <Input
                {...control}
                placeholder="SSC CGL Tier 1 — Mock Test Series"
                suggestion={name?.trim() === '' ? suggested : undefined}
                onAcceptSuggestion={(next) =>
                  form.setValue('name', next, { shouldDirty: true, shouldValidate: true })
                }
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="description"
            label="Description"
            /* ui-copy-ok: rule */ hint="Optional"
          >
            {(control) => <Textarea {...control} />}
          </FormField>

          <div className="flex flex-col gap-3 sm:col-span-2">
            <SeriesToggle
              form={form}
              name="sequentialTests"
              label="Open the tests in order"
              /* ui-copy-ok: rule */ hint="Off opens every test in the series together."
            />
            <SeriesToggle
              form={form}
              name="progressive"
              label="Progressive"
              /* ui-copy-ok: rule */ hint="Each paper harder than the last; students see the climb against the ramp."
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Access">
        <SeriesAccess form={form} detail={detail} onPickStage={setStage} />
      </FormSection>

      {existing ? <SeriesTests series={detail} /> : null}
      {/* The saved kind, not the chosen one: a series still carrying branches has to switch them off. */}
      {existing && detail.kind === TEST_SERIES_KIND.STANDARD ? (
        <BranchSchedule series={detail} />
      ) : null}
    </FormPanel>
  );
}

const testsKey = (seriesId: string) => [...QUERY_KEYS.TEST_SERIES, seriesId, 'tests'] as const;

/** The instant an exam starts, said in the institute's clock wherever the admin is sitting. */

interface UnlockFormValues {
  unlockAt: string;
}

function SeriesTests({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const queryClient = useQueryClient();
  const canWrite = useAuth().can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [opening, setOpening] = useState<SeriesTestRow | null>(null);
  const [removing, setRemoving] = useState<SeriesTestRow | null>(null);

  const tests = useQuery({
    queryKey: testsKey(series.id),
    queryFn: () => api.admin.testSeries.tests(series.id),
  });

  const held = (next: SeriesTestRow[]) => {
    queryClient.setQueryData(testsKey(series.id), next);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
  };

  const remove = useMutation({
    meta: { success: 'Test removed from this series.' },
    mutationFn: (row: SeriesTestRow) => api.admin.testSeries.removeTest(series.id, row.testId),
    onSuccess: (next) => {
      setRemoving(null);
      held(next);
    },
    onError: () => setRemoving(null),
  });

  return (
    <FormSection title="Tests">
      <DataTable
        columns={testColumns({ canWrite, onOpening: setOpening, onRemove: setRemoving })}
        rows={tests.data ?? []}
        rowKey={(row) => row.testId}
        isLoading={tests.isLoading}
        empty="No test is in this series yet. A test joins a series from its own Offer step."
      />

      {opening ? (
        <UnlockDialog
          key={opening.testId}
          series={series}
          row={opening}
          onClose={() => setOpening(null)}
          onSaved={held}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        destructive
        title={`Remove ${removing?.title ?? 'this test'} from ${series.name}?`}
        description={`Students reach it through this series and would stop being able to. The test itself, its paper and every other series it is in are untouched, and it can be put back at any time.`}
        confirmLabel="Remove it"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </FormSection>
  );
}

function testColumns(
  options: Readonly<{
    canWrite: boolean;
    onOpening: (row: SeriesTestRow) => void;
    onRemove: (row: SeriesTestRow) => void;
  }>,
): DataTableColumn<SeriesTestRow>[] {
  const { canWrite, onOpening, onRemove } = options;

  return [
    { key: 'order', header: '#', numeric: true, cell: (row) => row.order ?? '—' },
    {
      key: 'title',
      header: 'Test',
      className: 'w-full max-w-0',
      cell: (row) => <TruncatedText>{row.title}</TruncatedText>,
    },
    {
      key: 'opens',
      header: 'Opens',
      className: 'max-w-56',
      cell: (row) => <TruncatedText>{opensLabel(row.unlockAt)}</TruncatedText>,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) =>
        canWrite ? (
          <RowActions label={`Actions for ${row.title ?? 'this test'}`}>
            <DropdownMenuItem onSelect={() => onOpening(row)}>
              <Clock aria-hidden />
              Set when it opens
            </DropdownMenuItem>
            {row.attemptCount === 0 ? (
              <DropdownMenuItem destructive onSelect={() => onRemove(row)}>
                <Trash2 aria-hidden />
                Remove from this series
              </DropdownMenuItem>
            ) : null}
          </RowActions>
        ) : null,
    },
  ];
}

/** Wall time in, an instant out: `packages/ui` holds no zone, so the conversion is the app's. */
function UnlockDialog({
  series,
  row,
  onClose,
  onSaved,
}: Readonly<{
  series: TestSeriesSummary;
  row: SeriesTestRow;
  onClose: () => void;
  onSaved: (next: SeriesTestRow[]) => void;
}>) {
  const form = useForm<UnlockFormValues>({
    defaultValues: { unlockAt: row.unlockAt ? instituteWallTime(new Date(row.unlockAt)) : '' },
  });
  const unlockAt = useWatch({ control: form.control, name: 'unlockAt' });

  const save = useMutation({
    meta: { success: 'Opening time saved.' },
    mutationFn: (wall: string) =>
      api.admin.testSeries.setTestUnlock(series.id, row.testId, {
        unlockAt: wall ? fromInstituteWallTime(wall).toISOString() : null,
      }),
    onSuccess: (next) => {
      onClose();
      onSaved(next);
    },
    onError: (error) => applyFieldErrors(error, form.setError, ['unlockAt']),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => save.mutate(values.unlockAt)}
      title={`When does ${row.title ?? 'this test'} open?`}
      description={`Every branch running ${series.name} sits it from that instant. Leave it empty and it opens as soon as a student reaches the series.`}
      submitLabel="Save the time"
      loading={save.isPending}
    >
      <FormField form={form} name="unlockAt" label="Opens (IST)">
        {(control) => (
          <DateTimePicker
            id={control.id}
            aria-label="Opens"
            aria-describedby={control['aria-describedby']}
            value={unlockAt}
            onChange={(next) => form.setValue('unlockAt', next, { shouldDirty: true })}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

/** A boolean the form owns. Controlled, because `register` alone cannot hold a checkbox's state. */
function SeriesToggle({
  form,
  name,
  label,
  hint,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  name: 'sequentialTests' | 'progressive';
  label: string;
  hint?: string;
}>) {
  const checked = useWatch({ control: form.control, name });

  return (
    <Checkbox
      checked={checked}
      onChange={(event) => form.setValue(name, event.target.checked, { shouldDirty: true })}
      label={label}
      /* ui-copy-ok: rule */ hint={hint}
    />
  );
}

// ============================================================================
// Where it runs. Every branch already has a row — this only ever flips one.
// ============================================================================

/** Stable keys for placeholder rows, which have no identity of their own. */
const SKELETON_ROWS = ['branch-1', 'branch-2', 'branch-3'] as const;

function BranchSchedule({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canRead = can(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT);
  const canWrite = can(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [askingAll, setAskingAll] = useState(false);

  const branches = useQuery({
    queryKey: branchesKey(series.id),
    queryFn: () => api.admin.testSeries.branches(series.id),
    enabled: canRead,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: branchesKey(series.id) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
    // The branch screen reads the same rows from the other side, and would go stale behind this.
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCH_CONFIG });
  };

  const enableEverywhere = useMutation({
    meta: { success: 'Switched on at every branch.' },
    mutationFn: () => api.admin.testSeries.updateEveryBranch(series.id, { enabled: true }),
    onSuccess: () => {
      setAskingAll(false);
      refresh();
    },
    onError: () => setAskingAll(false),
  });

  const off = series.branchCount - series.enabledBranchCount;

  return (
    <FormSection title="Branches">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatRow
          label="Switched on at"
          value={`${series.enabledBranchCount} of ${plural(series.branchCount, 'branch', 'branches')}`}
        />
        {canWrite && off > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={enableEverywhere.isPending}
            onClick={() => setAskingAll(true)}
          >
            <Power aria-hidden />
            Switch on everywhere
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={askingAll}
        onOpenChange={(open) => !open && setAskingAll(false)}
        loading={enableEverywhere.isPending}
        title={`Switch ${series.name} on at every branch?`}
        description={`All ${plural(series.branchCount, 'branch', 'branches')} run it from now on, including the ${off} switched off today. A branch that was left off on purpose is switched on too.`}
        confirmLabel="Switch on everywhere"
        onConfirm={() => enableEverywhere.mutate()}
      />

      <BranchScheduleList
        series={series}
        rows={branches.data ?? []}
        isLoading={canRead && branches.isLoading}
        canRead={canRead}
        canWrite={canWrite}
        onSaved={refresh}
      />
    </FormSection>
  );
}

/** The three states of the list, so the card above stays one shape. */
function BranchScheduleList({
  series,
  rows,
  isLoading,
  canRead,
  canWrite,
  onSaved,
}: Readonly<{
  series: TestSeriesSummary;
  rows: readonly BranchTestConfigRow[];
  isLoading: boolean;
  canRead: boolean;
  canWrite: boolean;
  onSaved: () => void;
}>) {
  if (!canRead) {
    return (
      <Alert variant="info">
        <span>
          Branch scheduling is a permission of its own. You can see how far this series reaches, but
          not change it.
        </span>
      </Alert>
    );
  }

  // The list has a known shape, so it is drawn and held rather than spun at.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {SKELETON_ROWS.map((key) => (
          <Skeleton key={key} variant="row" className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <Alert variant="warning">There are no branches yet, so nothing runs this series.</Alert>;
  }

  return (
    <>
      {rows.map((row) => (
        <BranchScheduleRow
          key={row.id}
          series={series}
          row={row}
          canWrite={canWrite}
          onSaved={onSaved}
        />
      ))}
    </>
  );
}

/** Turning it on and turning it off are not the same question, so they are not the same words. */
function offerQuestion(
  series: TestSeriesSummary,
  row: BranchTestConfigRow,
  next: boolean,
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const tests = plural(series.testCount, 'test');

  if (next) {
    return {
      title: `Offer ${series.name} at ${row.branch.name}?`,
      description: `Every student whose current branch is ${row.branch.name} and who reaches this series — by their enrolment or by a grant — can start its ${tests} from then on, for as long as the series itself is switched on. When each test opens is the test's own, not this switch.`,
      confirmLabel: 'Offer it here',
      destructive: false,
    };
  }

  return {
    title: `Stop offering ${series.name} at ${row.branch.name}?`,
    description: `Students at ${row.branch.name} lose the route to its ${tests} straight away. Attempts already made and their results are kept, and a test somebody is sitting right now is not stopped. The row stays — this is what "not offered here" is — so switching it back on restores everything.`,
    confirmLabel: 'Stop offering it here',
    destructive: true,
  };
}

function BranchScheduleRow({
  series,
  row,
  canWrite,
  onSaved,
}: Readonly<{
  series: TestSeriesSummary;
  row: BranchTestConfigRow;
  canWrite: boolean;
  onSaved: () => void;
}>) {
  const [asking, setAsking] = useState<boolean | null>(null);

  const save = useMutation({
    meta: { success: `${row.branch.name} saved.` },
    mutationFn: (enabled: boolean) =>
      api.admin.testSeries.updateBranch(series.id, row.branchId, { enabled }),
    onSuccess: () => {
      setAsking(null);
      onSaved();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setAsking(null),
  });

  const question = offerQuestion(series, row, asking ?? !row.enabled);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
      <Checkbox
        checked={row.enabled}
        disabled={!canWrite || save.isPending}
        onChange={(event) => setAsking(event.target.checked)}
        label={row.branch.name}
      />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        destructive={question.destructive}
        loading={save.isPending}
        title={question.title}
        description={question.description}
        confirmLabel={question.confirmLabel}
        onConfirm={() => asking !== null && save.mutate(asking)}
      />
    </div>
  );
}
