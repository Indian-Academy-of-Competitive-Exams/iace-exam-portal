import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  UNLOCK_MODE,
  UNLOCK_MODES,
  fromInstituteWallTime,
  instituteWallTime,
  type BranchTestConfigRow,
  type CreateTestSeriesBody,
  type TestSeriesSummary,
  type UnlockMode,
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
  Field,
  FormField,
  FormPanel,
  FormSection,
  Input,
  PageHeader,
  plural,
  Skeleton,
  SkeletonParagraph,
  StatRow,
  Textarea,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, UNLOCK_MODE_LABELS } from '../lib/constants';
import { WHEN_FORMATTER } from '../lib/audit-format';
import { useAuth } from '../providers/auth';
import { ExamStagePicker } from '../components/exam-picker';
import { ProgramPicker, TestSeriesPicker } from '../components/access-picker';

/**
 * One series: who it is for, and — once it exists — which branches run it. The two are separate
 * permissions, so the scheduling card can be read-only on the same screen the rest is editable.
 */

interface SeriesFormValues {
  name: string;
  description: string;
  examStageId: string;
  programCode: string;
  prerequisiteSeriesId: string;
  unlockMode: UnlockMode;
  sequentialTests: boolean;
  isFree: boolean;
}

const SERIES_KEY = ['admin', 'test-series'] as const;
const seriesKey = (id: string) => ['admin', 'test-series', id] as const;
const branchesKey = (id: string) => ['admin', 'test-series', id, 'branches'] as const;

/** Every path the server can name that this form registers, so a failure lands on its own input. */
const SERVER_FIELDS = [
  'name',
  'description',
  'examStageId',
  'programCode',
  'prerequisiteSeriesId',
  'unlockMode',
] as const;

function valuesOf(detail: TestSeriesSummary | null): SeriesFormValues {
  return {
    name: detail?.name ?? '',
    description: detail?.description ?? '',
    examStageId: detail?.examStageId ?? '',
    programCode: detail?.programCode ?? '',
    prerequisiteSeriesId: detail?.prerequisiteSeriesId ?? '',
    unlockMode: detail?.unlockMode ?? UNLOCK_MODE.AUTO,
    sequentialTests: detail?.sequentialTests ?? false,
    isFree: detail?.isFree ?? false,
  };
}

/** An empty picker means "no choice", which the API expresses as null. */
function bodyOf(values: SeriesFormValues): CreateTestSeriesBody {
  return {
    name: values.name,
    description: values.description.trim(),
    examStageId: values.examStageId || null,
    programCode: values.programCode || null,
    prerequisiteSeriesId: values.prerequisiteSeriesId || null,
    unlockMode: values.unlockMode,
    sequentialTests: values.sequentialTests,
    isFree: values.isFree,
  };
}

export function TestSeriesFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;

  const series = useQuery({
    queryKey: seriesKey(id ?? ''),
    queryFn: () => api.admin.testSeries.detail(id!),
    enabled: editing,
  });

  // The form has a known shape, so it is drawn and held rather than spun at.
  if (editing && series.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={9} />
        </Card>
      </div>
    );
  }

  if (editing && (series.error || !series.data)) {
    return <Alert variant="danger">Could not load this series.</Alert>;
  }

  // Mounted only once the saved series is here, so a refetch cannot throw away a half-typed edit.
  return <SeriesEditor detail={series.data ?? null} />;
}

function SeriesEditor({ detail }: Readonly<{ detail: TestSeriesSummary | null }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = detail !== null;

  const form = useForm<SeriesFormValues>({ defaultValues: valuesOf(detail) });

  const save = useMutation({
    meta: { success: editing ? 'Series saved.' : 'Series created.', fields: SERVER_FIELDS },
    mutationFn: (values: SeriesFormValues) =>
      detail
        ? api.admin.testSeries.update(detail.id, bodyOf(values))
        : api.admin.testSeries.create(bodyOf(values)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      queryClient.setQueryData(seriesKey(saved.id), saved);
      // A new series is switched off at every branch, so the next step is always
      // the scheduling card — which only exists once it has been created.
      navigate(editing ? ROUTES.TEST_SERIES : ROUTES.TEST_SERIES_DETAIL(saved.id));
    },
    onError: (error) => applyFieldErrors(error, form.setError, SERVER_FIELDS),
  });

  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const unlockMode = useWatch({ control: form.control, name: 'unlockMode' }) ?? UNLOCK_MODE.AUTO;
  const programCode = useWatch({ control: form.control, name: 'programCode' });
  const prerequisiteSeriesId = useWatch({ control: form.control, name: 'prerequisiteSeriesId' });
  const banner = bannerMessage(save.error, SERVER_FIELDS);

  // The series it waits on can sit outside the picker's first page, and an id is not a name.
  const prerequisite = useQuery({
    queryKey: seriesKey(prerequisiteSeriesId),
    queryFn: () => api.admin.testSeries.detail(prerequisiteSeriesId),
    enabled: prerequisiteSeriesId !== '',
  });

  return (
    <FormPanel
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        <>
          <Button type="button" variant="outline" asChild>
            <Link to={ROUTES.TEST_SERIES}>Cancel</Link>
          </Button>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save series' : 'Create series'}
          </Button>
        </>
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={editing ? `Edit ${detail.name}` : 'New test series'}
          />

          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    >
      <FormSection title="Who it is for">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField form={form} name="name" label="Name">
            {(control) => <Input {...control} placeholder="SSC CGL 2026 — Tier 1 mocks" />}
          </FormField>

          <FormField form={form} name="examStageId" label="Stage" hint="Optional">
            {(control) => (
              <ExamStagePicker
                id={control.id}
                value={examStageId}
                clearable
                selectedLabel={
                  detail?.examStage
                    ? `${detail.examStage.examCode} / ${detail.examStage.name}`
                    : undefined
                }
                placeholder="Any stage"
                onChange={(value) => form.setValue('examStageId', value, { shouldDirty: true })}
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="programCode"
            label="Program"
            hint="Set it and only students carrying that program reach the series."
          >
            {(control) => (
              <ProgramPicker
                id={control.id}
                value={programCode}
                clearable
                selectedLabel={detail?.programCode ?? undefined}
                onChange={(value) => form.setValue('programCode', value, { shouldDirty: true })}
              />
            )}
          </FormField>

          <FormField form={form} name="description" label="Description" hint="Optional">
            {(control) => <Textarea {...control} />}
          </FormField>
        </div>
      </FormSection>

      <FormSection title="How it opens">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField form={form} name="unlockMode" label="Unlocks">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={unlockMode}
                onChange={(next) =>
                  form.setValue('unlockMode', next as UnlockMode, { shouldDirty: true })
                }
                items={UNLOCK_MODES.map((mode) => ({
                  value: mode,
                  label: UNLOCK_MODE_LABELS[mode],
                }))}
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="prerequisiteSeriesId"
            label="Waits on"
            hint="The series a student finishes first. Optional."
          >
            {(control) => (
              <TestSeriesPicker
                id={control.id}
                value={prerequisiteSeriesId}
                clearable
                excludeId={detail?.id}
                selectedLabel={prerequisite.data?.name}
                placeholder="Nothing"
                onChange={(value) =>
                  form.setValue('prerequisiteSeriesId', value, { shouldDirty: true })
                }
              />
            )}
          </FormField>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <SeriesToggle
              form={form}
              name="sequentialTests"
              label="Unlock the tests in order"
              hint="Off opens every test in the series together."
            />
            <SeriesToggle
              form={form}
              name="isFree"
              label="Free"
              hint="Pricing only — who can reach it is decided above."
            />
          </div>
        </div>
      </FormSection>

      {editing ? <BranchSchedule series={detail} /> : null}
    </FormPanel>
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
  name: 'sequentialTests' | 'isFree';
  label: string;
  hint?: string;
}>) {
  const checked = useWatch({ control: form.control, name });

  return (
    <Checkbox
      checked={checked}
      onChange={(event) => form.setValue(name, event.target.checked, { shouldDirty: true })}
      label={label}
      hint={hint}
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

  const branches = useQuery({
    queryKey: branchesKey(series.id),
    queryFn: () => api.admin.testSeries.branches(series.id),
    enabled: canRead,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: branchesKey(series.id) });
    void queryClient.invalidateQueries({ queryKey: SERIES_KEY });
  };

  return (
    <FormSection title="Where it runs">
      <StatRow
        label="Switched on at"
        value={`${series.enabledBranchCount} of ${plural(series.branchCount, 'branch', 'branches')}`}
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

interface ScheduleDraft {
  enabled: boolean;
  startAt: string;
  endAt: string;
}

/** Both ends read the institute's clock, so a window means the same wherever the admin is. */
const toLocalInput = (iso: string | null): string => (iso ? instituteWallTime(new Date(iso)) : '');

const toIso = (local: string): string | null =>
  local ? fromInstituteWallTime(local).toISOString() : null;

const draftOf = (row: BranchTestConfigRow): ScheduleDraft => ({
  enabled: row.enabled,
  startAt: toLocalInput(row.startAt),
  endAt: toLocalInput(row.endAt),
});

const sameDraft = (a: ScheduleDraft, b: ScheduleDraft): boolean =>
  a.enabled === b.enabled && a.startAt === b.startAt && a.endAt === b.endAt;

/** What the window will mean once saved, said in words rather than left to two inputs. */
function windowSentence(draft: ScheduleDraft): string {
  const from = draft.startAt ? WHEN_FORMATTER.format(new Date(draft.startAt)) : '';
  const until = draft.endAt ? WHEN_FORMATTER.format(new Date(draft.endAt)) : '';

  if (from && until) return `It runs there from ${from} until ${until}.`;
  if (from) return `It opens there on ${from} and has no end.`;
  if (until) return `It runs there until ${until}.`;
  return 'No window is set, so it runs there for as long as it is switched on.';
}

/** The question this save asks — turning it on and turning it off are not the same one. */
function scheduleQuestion(
  series: TestSeriesSummary,
  row: BranchTestConfigRow,
  draft: ScheduleDraft,
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const tests = plural(series.testCount, 'test');
  const runs = windowSentence(draft);

  if (draft.enabled && !row.enabled) {
    return {
      title: `Offer ${series.name} at ${row.branch.name}?`,
      description: `Every student whose current branch is ${row.branch.name} and who reaches this series — by enrolment, by program or by a grant — can start its ${tests} from then on. ${runs}`,
      confirmLabel: 'Offer it here',
      destructive: false,
    };
  }

  if (!draft.enabled && row.enabled) {
    return {
      title: `Stop offering ${series.name} at ${row.branch.name}?`,
      description: `Students at ${row.branch.name} lose the route to its ${tests} straight away. Attempts already made and their results are kept, and a test somebody is sitting right now is not stopped. The row stays — this is what "not offered here" is — so switching it back on restores everything.`,
      confirmLabel: 'Stop offering it here',
      destructive: true,
    };
  }

  const effect = row.enabled
    ? `Students at ${row.branch.name} reach its ${tests} only inside that window.`
    : `It is switched off at ${row.branch.name}, so the window only takes effect once it is switched on.`;

  return {
    title: `Change when ${series.name} runs at ${row.branch.name}?`,
    description: `${runs} ${effect}`,
    confirmLabel: 'Save the window',
    destructive: false,
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
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(row));
  const [asking, setAsking] = useState(false);

  const save = useMutation({
    meta: { success: `${row.branch.name} saved.` },
    mutationFn: () =>
      api.admin.testSeries.updateBranch(series.id, row.branchId, {
        enabled: draft.enabled,
        startAt: toIso(draft.startAt),
        endAt: toIso(draft.endAt),
      }),
    onSuccess: () => {
      setAsking(false);
      onSaved();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setAsking(false),
  });

  const backwards = draft.startAt !== '' && draft.endAt !== '' && draft.endAt <= draft.startAt;
  const dirty = !sameDraft(draft, draftOf(row));
  const question = scheduleQuestion(series, row, draft);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <div className="min-w-48 flex-1 pb-2">
        <Checkbox
          checked={draft.enabled}
          disabled={!canWrite}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          label={row.branch.name}
          hint={draft.enabled ? 'Offered here' : 'Not offered here'}
        />
      </div>

      <Field htmlFor={`${row.id}-start`} label="Opens" className="w-56">
        {(control) => (
          <Input
            {...control}
            type="datetime-local"
            aria-label={`Opens at ${row.branch.name}`}
            disabled={!canWrite}
            value={draft.startAt}
            onChange={(event) => setDraft({ ...draft, startAt: event.target.value })}
          />
        )}
      </Field>

      <Field
        htmlFor={`${row.id}-end`}
        label="Closes"
        error={backwards ? 'The window has to end after it starts' : undefined}
        className="w-56"
      >
        {(control) => (
          <Input
            {...control}
            type="datetime-local"
            aria-label={`Closes at ${row.branch.name}`}
            disabled={!canWrite}
            value={draft.endAt}
            onChange={(event) => setDraft({ ...draft, endAt: event.target.value })}
          />
        )}
      </Field>

      {canWrite ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!dirty || backwards}
          onClick={() => setAsking(true)}
        >
          Save
        </Button>
      ) : null}

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        destructive={question.destructive}
        loading={save.isPending}
        title={question.title}
        description={question.description}
        confirmLabel={question.confirmLabel}
        onConfirm={() => save.mutate()}
      />
    </div>
  );
}
