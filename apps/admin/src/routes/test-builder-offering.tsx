import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Power } from 'lucide-react';
import { TEST_STATUS, type TestDetail } from '@iace/contracts';
import { Alert, Button, ConfirmDialog, Field, FormSection, plural } from '@iace/ui';
import { api } from '../lib/api';
import { TEST_STATUS_LABELS } from '../lib/constants';
import { TestSeriesMultiPicker } from '../components/access-picker';

/** Who is offered the test: the series that carry it, and the freeze that lets students sit it. */

const SERIES_KEY = (testId: string) => ['admin', 'test-series-links', testId] as const;

const OFFERING_CONFIRMS = { FINALIZE: 'finalize', RETIRE: 'retire' } as const;
type OfferingConfirm = (typeof OFFERING_CONFIRMS)[keyof typeof OFFERING_CONFIRMS];

export function OfferingStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<OfferingConfirm | null>(null);

  const links = useQuery({
    queryKey: SERIES_KEY(detail.id),
    queryFn: () => api.admin.tests.series(detail.id),
  });
  const chosen = (links.data ?? []).map((link) => link.testSeriesId);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'test', detail.id] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'tests'] });
  };

  const setSeries = useMutation({
    meta: { success: 'Series updated.' },
    mutationFn: (testSeriesIds: string[]) =>
      api.admin.tests.setSeries(detail.id, {
        series: testSeriesIds.map((testSeriesId, index) => ({ testSeriesId, order: index + 1 })),
      }),
    onSuccess: (next) => queryClient.setQueryData(SERIES_KEY(detail.id), next),
  });

  const finalize = useMutation({
    meta: { success: 'Test finalized. Its paper is frozen.' },
    mutationFn: () => api.admin.tests.finalize(detail.id),
    onSuccess: async () => {
      setAsking(null);
      await refresh();
    },
    onError: () => setAsking(null),
  });

  const setStatus = useMutation({
    meta: { success: 'Test updated.' },
    mutationFn: (status: typeof TEST_STATUS.ACTIVE | typeof TEST_STATUS.INACTIVE) =>
      api.admin.tests.setStatus(detail.id, { status }),
    onSuccess: async () => {
      setAsking(null);
      await refresh();
    },
    onError: () => setAsking(null),
  });

  const offered = detail.status === TEST_STATUS.ACTIVE;

  return (
    <FormSection title="Where it is offered" meta={TEST_STATUS_LABELS[detail.status]}>
      {detail.isLocked ? null : (
        <Alert variant="info">
          Finalizing freezes the paper and locks the base configuration it inherits. A test can only
          be offered once it is frozen, because until then there is nothing for a student to sit.
        </Alert>
      )}

      <Field
        htmlFor="test-series"
        label="Series"
        hint="A test reaches a student only through a series"
      >
        {(control) => (
          <TestSeriesMultiPicker
            {...control}
            value={chosen}
            disabled={setSeries.isPending}
            onChange={(next) => setSeries.mutate(next)}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        {detail.isLocked ? null : (
          <Button
            type="button"
            onClick={() => setAsking(OFFERING_CONFIRMS.FINALIZE)}
            loading={finalize.isPending}
          >
            <Lock aria-hidden />
            Finalize
          </Button>
        )}

        {detail.isLocked ? (
          <Button
            type="button"
            variant={offered ? 'outline' : 'default'}
            loading={setStatus.isPending}
            onClick={() =>
              offered ? setAsking(OFFERING_CONFIRMS.RETIRE) : setStatus.mutate(TEST_STATUS.ACTIVE)
            }
          >
            <Power aria-hidden />
            {offered ? 'Retire' : 'Offer to students'}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={asking === OFFERING_CONFIRMS.FINALIZE}
        onOpenChange={(open) => !open && setAsking(null)}
        title={`Finalize ${detail.title ?? 'this test'}?`}
        description={`The ${plural(detail.totalQuestions, 'question')} drawn for this test freeze, and ${detail.baseConfigName} locks with them — after this the way to change its shape is to clone it. This cannot be undone.`}
        confirmLabel="Finalize test"
        loading={finalize.isPending}
        onConfirm={() => finalize.mutate()}
      />

      <ConfirmDialog
        open={asking === OFFERING_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && setAsking(null)}
        destructive
        title={`Retire ${detail.title ?? 'this test'}?`}
        description={`Every student reached through ${plural(chosen.length, 'series', 'series')} stops being offered this test. Attempts already sat keep their results, and you can offer it again later.`}
        confirmLabel="Retire test"
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate(TEST_STATUS.INACTIVE)}
      />
    </FormSection>
  );
}
