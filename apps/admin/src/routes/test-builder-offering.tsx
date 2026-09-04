import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, X } from 'lucide-react';
import { AppException, TEST_STATUS, offerRequirements, type TestDetail } from '@iace/contracts';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  DateTimePicker,
  Field,
  FormSection,
  NumericInput,
  SectionHeading,
  SkeletonParagraph,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  digitsOnly,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { ProgramPicker, TestSeriesMultiPicker } from '../components/access-picker';
import { QUERY_KEYS } from '../lib/constants';
import { toSeconds } from '../lib/schedule-format';
import {
  changesOf,
  instantOf,
  savedSchedule,
  type ProgramOpening,
  type ScheduleDraft,
} from './test-schedule-draft';

/** Who is offered the test: the series that carry it, and the freeze that lets students sit it. */

const SERIES_LINKS_KEY = (testId: string) => [...QUERY_KEYS.TEST_SERIES_LINKS, testId] as const;

function useOfferingRefresh(testId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.TEST, testId] });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
    // Series membership decides which branches reach the test, and the schedule step reads that.
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCH_TIMING });
  };
}

export function SeriesStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const refresh = useOfferingRefresh(detail.id);

  const links = useQuery({
    queryKey: SERIES_LINKS_KEY(detail.id),
    queryFn: () => api.admin.tests.series(detail.id),
  });
  const chosen = (links.data ?? []).map((link) => link.testSeriesId);

  const setSeries = useMutation({
    meta: { success: 'Series updated.' },
    mutationFn: (testSeriesIds: string[]) =>
      api.admin.tests.setSeries(detail.id, {
        series: testSeriesIds.map((testSeriesId, index) => ({ testSeriesId, order: index + 1 })),
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(SERIES_LINKS_KEY(detail.id), next);
      await refresh();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Field htmlFor="test-series" label="Series">
        {(control) => (
          <TestSeriesMultiPicker
            {...control}
            value={chosen}
            disabled={setSeries.isPending}
            forExamStageId={detail.examStageId}
            onChange={(next) => setSeries.mutate(next)}
          />
        )}
      </Field>
    </div>
  );
}

/** When the test opens, how late a student may still begin, and which programs open it sooner. */

const TIMING_KEY = (testId: string) => [...QUERY_KEYS.BRANCH_TIMING, testId] as const;

interface ProgramRefusal {
  programCode: string;
  message: string;
}

const PROGRAM_RULE =
  'A program opening lets that cohort start earlier. Entry still closes at the same instant for everyone, so their window is longer rather than moved.';

const NO_BRANCH_RUNS_IT =
  'No branch runs a series holding this test yet, so late entry and extra time cannot be set. Switch one of its series on at a branch first.';

/** The server owns the rule; this only puts its refusal under the row that caused it. */
const refusalOf = (programCode: string, error: unknown): ProgramRefusal | null => {
  const message = AppException.is(error) ? error.fieldErrors?.opensAt?.[0] : undefined;
  return message ? { programCode, message } : null;
};

/** The clock is still kept per branch underneath, so one pair goes to every branch this reaches. */
const writeTiming = (testId: string, branchIds: readonly string[], held: ScheduleDraft) =>
  api.admin.tests.setBranchTiming(testId, {
    branches: branchIds.map((branchId) => ({
      branchId,
      lateEntrySec: toSeconds(held.lateEntry),
      extraTimeSec: toSeconds(held.extraTime),
    })),
  });

/** The test's own clock, and the programs that reach it ahead of everybody else. */
export function ScheduleStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const refresh = useOfferingRefresh(detail.id);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState<ProgramRefusal | null>(null);
  const seriesId = detail.testSeriesId;

  const timing = useQuery({
    queryKey: TIMING_KEY(detail.id),
    queryFn: () => api.admin.tests.branchTiming(detail.id),
    enabled: seriesId !== null,
  });

  const branchIds = (timing.data ?? []).map((row) => row.branchId);
  const saved = savedSchedule(detail);
  const held = draft ?? saved;
  const changes = changesOf(saved, held);

  const save = useMutation({
    meta: { success: 'Schedule saved.', fields: ['opensAt'] },
    mutationFn: async () => {
      if (changes.opening && seriesId) {
        await api.admin.testSeries.setTestUnlock(seriesId, detail.id, {
          unlockAt: held.opensAt ? instantOf(held.opensAt) : null,
        });
      }
      if (changes.timing) await writeTiming(detail.id, branchIds, held);

      for (const row of changes.written) {
        try {
          await api.admin.tests.setProgramUnlock(detail.id, row.programCode, {
            opensAt: instantOf(row.opensAt),
          });
        } catch (error) {
          setRefused(refusalOf(row.programCode, error));
          throw error;
        }
      }

      for (const programCode of changes.cleared) {
        await api.admin.tests.clearProgramUnlock(detail.id, programCode);
      }
    },
    onMutate: () => setRefused(null),
    onSuccess: () => setDraft(null),
    // An opening deletes every program row it overtakes, so what stuck is read back, never assumed.
    onSettled: async () => {
      setAsking(false);
      await refresh();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCH_CONFIG });
    },
  });

  const setField = (field: 'opensAt' | 'lateEntry' | 'extraTime', value: string) =>
    setDraft({ ...held, [field]: value });

  const setProgram = (programCode: string, opensAt: string) =>
    setDraft({
      ...held,
      programs: held.programs.map((row) =>
        row.programCode === programCode ? { ...row, opensAt } : row,
      ),
    });

  const addProgram = (programCode: string) => {
    if (held.programs.some((row) => row.programCode === programCode)) return;
    setDraft({ ...held, programs: [...held.programs, { programCode, opensAt: held.opensAt }] });
  };

  const dropProgram = (programCode: string) =>
    setDraft({
      ...held,
      programs: held.programs.filter((row) => row.programCode !== programCode),
    });

  if (!seriesId) {
    return (
      <Alert variant="info">
        A test opens through the series carrying it. Add this one to a series above, and its clock
        can be set here.
      </Alert>
    );
  }

  if (timing.isLoading) return <SkeletonParagraph lines={3} />;

  const reachesABranch = branchIds.length > 0;

  return (
    <FormSection title="Schedule">
      <div className="flex flex-wrap items-start gap-4">
        <Field
          htmlFor="test-opens"
          label="Opens (IST)"
          className="min-w-72 flex-1"
          /* ui-copy-ok: rule */ hint="Blank opens it the moment a student reaches it."
        >
          {(control) => (
            <DateTimePicker
              id={control.id}
              aria-label="Opens"
              aria-describedby={control['aria-describedby']}
              value={held.opensAt}
              onChange={(next) => setField('opensAt', next)}
            />
          )}
        </Field>

        <Field htmlFor="test-late-entry" label="Late entry (minutes)" className="w-44">
          {(control) => (
            <NumericInput
              {...control}
              placeholder="None"
              disabled={!reachesABranch}
              value={held.lateEntry}
              onChange={(event) => setField('lateEntry', digitsOnly(event.target.value))}
            />
          )}
        </Field>

        <Field htmlFor="test-extra-time" label="Extra time (minutes)" className="w-44">
          {(control) => (
            <NumericInput
              {...control}
              placeholder="None"
              disabled={!reachesABranch}
              value={held.extraTime}
              onChange={(event) => setField('extraTime', digitsOnly(event.target.value))}
            />
          )}
        </Field>
      </div>

      <Alert variant={reachesABranch ? 'info' : 'warning'}>
        {reachesABranch ? PROGRAM_RULE : NO_BRANCH_RUNS_IT}
      </Alert>

      <SectionHeading level={3} title="Program openings" />

      {held.programs.map((row, index) => (
        <ProgramOpeningRow
          key={row.programCode}
          row={row}
          index={index}
          error={refused?.programCode === row.programCode ? refused.message : undefined}
          onChange={(next) => setProgram(row.programCode, next)}
          onRemove={() => dropProgram(row.programCode)}
        />
      ))}

      <div className="w-72">
        <ProgramPicker
          value=""
          clearable={false}
          placeholder="Add a program"
          aria-label="Add a program"
          onChange={addProgram}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={changes.count === 0} onClick={() => setAsking(true)}>
          Save schedule
        </Button>
        {changes.count > 0 ? (
          <p className="text-sm text-muted-foreground">{`${plural(changes.count, 'change')} pending`}</p>
        ) : null}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        title="Save the schedule?"
        description={`${plural(changes.count, 'change')} to when this test can be started. Late entry is counted from the opening, and both it and extra time replace whatever each branch running this test set for itself. A program opening left later than the test's own is dropped.`}
        confirmLabel="Save schedule"
        loading={save.isPending}
        onConfirm={() => save.mutate()}
      />
    </FormSection>
  );
}

/** One program and when it opens. Its own component so the index only ever names the control. */
function ProgramOpeningRow({
  row,
  index,
  error,
  onChange,
  onRemove,
}: Readonly<{
  row: ProgramOpening;
  index: number;
  error?: string;
  onChange: (opensAt: string) => void;
  onRemove: () => void;
}>) {
  return (
    <Field
      htmlFor={`program-opens-${index}`}
      label={`${row.programCode} opens (IST)`}
      className="max-w-lg"
      error={error}
    >
      {(control) => (
        <div className="flex items-center gap-2">
          <DateTimePicker
            id={control.id}
            aria-label={`${row.programCode} opens`}
            aria-describedby={control['aria-describedby']}
            className="flex-1"
            value={row.opensAt}
            onChange={onChange}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${row.programCode}`}
                onClick={onRemove}
              >
                <X aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove {row.programCode}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </Field>
  );
}

export function PublishStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const [retiring, setRetiring] = useState(false);
  const refresh = useOfferingRefresh(detail.id);

  const offer = useMutation({
    meta: { success: 'Test offered to students.' },
    // One call: the freeze and the opening are one transaction, so neither lands without the other.
    mutationFn: () => api.admin.tests.offer(detail.id),
    onSuccess: refresh,
  });

  const retire = useMutation({
    meta: { success: 'Test retired.' },
    mutationFn: () => api.admin.tests.setStatus(detail.id, { status: TEST_STATUS.INACTIVE }),
    onSuccess: async () => {
      setRetiring(false);
      await refresh();
    },
    onError: () => setRetiring(false),
  });

  const offered = detail.status === TEST_STATUS.ACTIVE;
  const requirements = offerRequirements(detail);
  const ready = requirements.every((requirement) => requirement.met);

  if (offered) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="success">
          {`Students reached through ${plural(detail.seriesCount, 'series', 'series')} are being offered this test. Its paper is frozen — editing it takes the test back out until it is offered again.`}
        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            loading={retire.isPending}
            onClick={() => setRetiring(true)}
          >
            <Power aria-hidden />
            Retire
          </Button>
        </div>

        <ConfirmDialog
          open={retiring}
          onOpenChange={(open) => !open && setRetiring(false)}
          destructive
          title={`Retire ${detail.title ?? 'this test'}?`}
          description={`Every student reached through ${plural(detail.seriesCount, 'series', 'series')} stops being offered this test. Attempts already sat keep their results, and you can offer it again later.`}
          confirmLabel="Retire test"
          loading={retire.isPending}
          onConfirm={() => retire.mutate()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert variant={ready ? 'info' : 'warning'}>
        {ready
          ? offerEffect(detail)
          : 'This test cannot be offered yet. What it still owes is ticked off below.'}
      </Alert>

      <ul className="flex flex-col gap-1">
        {requirements.map((requirement) => (
          <li key={requirement.key}>
            <Checkbox
              checked={requirement.met}
              readOnly
              tabIndex={-1}
              label={requirement.label}
              /* ui-copy-ok: rule */ hint={requirement.owed ?? undefined}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={!ready}
          loading={offer.isPending}
          onClick={() => offer.mutate()}
        >
          <Power aria-hidden />
          Freeze and offer
        </Button>
      </div>
    </div>
  );
}

/** The button is the last step, so what it will do is said on the page rather than in a dialog. */
function offerEffect(detail: TestDetail): string {
  const freeze = detail.isLocked
    ? ''
    : `Its ${plural(detail.totalQuestions, 'question')} freeze, and every student sits exactly them. `;
  return `${freeze}Every student reached through ${plural(detail.seriesCount, 'series', 'series')} is offered it from now on. Editing the paper afterwards takes the test back out until it is offered again.`;
}
