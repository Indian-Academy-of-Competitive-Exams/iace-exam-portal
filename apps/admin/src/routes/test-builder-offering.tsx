import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import {
  TEST_STATUS,
  offerRequirements,
  type BranchTestScheduleRow,
  type TestDetail,
} from '@iace/contracts';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  NumericInput,
  SkeletonParagraph,
  digitsOnly,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { TestSeriesMultiPicker } from '../components/access-picker';
import { QUERY_KEYS } from '../lib/constants';
import { toMinutes, toSeconds } from '../lib/schedule-format';

/** Who is offered the test: the series that carry it, and the freeze that lets students sit it. */

const SERIES_LINKS_KEY = (testId: string) => [...QUERY_KEYS.TEST_SERIES_LINKS, testId] as const;

function useOfferingRefresh(testId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.TEST, testId] });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
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

const TIMING_KEY = (testId: string) => [...QUERY_KEYS.BRANCH_TIMING, testId] as const;

type TimingDraft = Readonly<Record<string, { lateEntry: string; extraTime: string }>>;

const draftOf = (rows: readonly BranchTestScheduleRow[]): TimingDraft =>
  Object.fromEntries(
    rows.map((row) => [
      row.branchId,
      { lateEntry: toMinutes(row.lateEntrySec), extraTime: toMinutes(row.extraTimeSec) },
    ]),
  );

const changedCount = (rows: readonly BranchTestScheduleRow[], draft: TimingDraft): number => {
  const saved = draftOf(rows);
  return rows.filter(
    (row) =>
      saved[row.branchId]?.lateEntry !== draft[row.branchId]?.lateEntry ||
      saved[row.branchId]?.extraTime !== draft[row.branchId]?.extraTime,
  ).length;
};

/** What one branch does differently: how late its students may join, and how much longer they get. */
export function BranchTimingStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TimingDraft | null>(null);
  const [asking, setAsking] = useState(false);

  const timing = useQuery({
    queryKey: TIMING_KEY(detail.id),
    queryFn: () => api.admin.tests.branchTiming(detail.id),
  });

  const rows = timing.data ?? [];
  const held = draft ?? draftOf(rows);
  const changed = changedCount(rows, held);

  const save = useMutation({
    meta: { success: 'Branch timing saved.' },
    mutationFn: () =>
      api.admin.tests.setBranchTiming(detail.id, {
        branches: rows.map((row) => ({
          branchId: row.branchId,
          lateEntrySec: toSeconds(held[row.branchId]?.lateEntry ?? ''),
          extraTimeSec: toSeconds(held[row.branchId]?.extraTime ?? ''),
        })),
      }),
    onSuccess: (next) => {
      setAsking(false);
      setDraft(null);
      queryClient.setQueryData(TIMING_KEY(detail.id), next);
      // The branch screen reads the same rows from the other side, and would go stale behind this.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCH_CONFIG });
    },
    onError: () => setAsking(false),
  });

  const set = (branchId: string, field: 'lateEntry' | 'extraTime', value: string) =>
    setDraft({ ...held, [branchId]: { ...held[branchId]!, [field]: digitsOnly(value) } });

  if (timing.isLoading) return <SkeletonParagraph lines={3} />;

  if (rows.length === 0) {
    return (
      <Alert variant="info">
        No branch runs a series holding this test yet, so there is nobody to give extra time to.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div
            key={row.branchId}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
          >
            <p className="min-w-40 flex-1 pb-2 text-sm font-medium text-foreground">
              {row.branch.name}
            </p>

            <Field htmlFor={`late-${row.branchId}`} label="Late entry (minutes)" className="w-44">
              {(control) => (
                <NumericInput
                  {...control}
                  aria-label={`Late entry at ${row.branch.name}, in minutes`}
                  placeholder="None"
                  value={held[row.branchId]?.lateEntry ?? ''}
                  onChange={(event) => set(row.branchId, 'lateEntry', event.target.value)}
                />
              )}
            </Field>

            <Field htmlFor={`extra-${row.branchId}`} label="Extra time (minutes)" className="w-44">
              {(control) => (
                <NumericInput
                  {...control}
                  aria-label={`Extra time at ${row.branch.name}, in minutes`}
                  placeholder="None"
                  value={held[row.branchId]?.extraTime ?? ''}
                  onChange={(event) => set(row.branchId, 'extraTime', event.target.value)}
                />
              )}
            </Field>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={changed === 0} onClick={() => setAsking(true)}>
          Save branch timing
        </Button>
        {changed > 0 ? (
          <p className="text-sm text-muted-foreground">{`${plural(changed, 'branch', 'branches')} changed`}</p>
        ) : null}
      </div>

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        title="Save branch timing?"
        description={`${plural(changed, 'branch', 'branches')} change. Late entry is counted from the moment the test opens, and extra time is added to the clock every student at that branch gets. A blank leaves the branch on the plain rules.`}
        confirmLabel="Save branch timing"
        loading={save.isPending}
        onConfirm={() => save.mutate()}
      />
    </div>
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
