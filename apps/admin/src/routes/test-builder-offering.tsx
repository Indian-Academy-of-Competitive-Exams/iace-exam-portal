import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import { PAPER_BINDING, TEST_STATUS, type TestDetail } from '@iace/contracts';
import { Alert, Button, ConfirmDialog, Field, plural } from '@iace/ui';
import { api } from '../lib/api';
import { TestSeriesMultiPicker } from '../components/access-picker';

/** Who is offered the test: the series that carry it, and the freeze that lets students sit it. */

const SERIES_KEY = (testId: string) => ['admin', 'test-series-links', testId] as const;

const OFFERING_CONFIRMS = { OFFER: 'offer', RETIRE: 'retire' } as const;
type OfferingConfirm = (typeof OFFERING_CONFIRMS)[keyof typeof OFFERING_CONFIRMS];

function useOfferingRefresh(testId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'test', testId] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'tests'] });
  };
}

export function SeriesStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const refresh = useOfferingRefresh(detail.id);

  const links = useQuery({
    queryKey: SERIES_KEY(detail.id),
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
      queryClient.setQueryData(SERIES_KEY(detail.id), next);
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
            onChange={(next) => setSeries.mutate(next)}
          />
        )}
      </Field>
    </div>
  );
}

export function PublishStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const [asking, setAsking] = useState<OfferingConfirm | null>(null);
  const refresh = useOfferingRefresh(detail.id);

  const offer = useMutation({
    meta: { success: 'Test offered to students.' },
    // Freezing is what offering NEEDS, not a step an admin came here to take on its own.
    mutationFn: async () => {
      if (!detail.isLocked) await api.admin.tests.finalize(detail.id);
      return api.admin.tests.setStatus(detail.id, { status: TEST_STATUS.ACTIVE });
    },
    onSuccess: async () => {
      setAsking(null);
      await refresh();
    },
    onError: () => setAsking(null),
  });

  const retire = useMutation({
    meta: { success: 'Test retired.' },
    mutationFn: () => api.admin.tests.setStatus(detail.id, { status: TEST_STATUS.INACTIVE }),
    onSuccess: async () => {
      setAsking(null);
      await refresh();
    },
    onError: () => setAsking(null),
  });

  const offered = detail.status === TEST_STATUS.ACTIVE;

  return (
    <div className="flex flex-col gap-4">
      <PublishNotice detail={detail} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={offered ? 'outline' : 'default'}
          loading={offer.isPending || retire.isPending}
          onClick={() => setAsking(offered ? OFFERING_CONFIRMS.RETIRE : OFFERING_CONFIRMS.OFFER)}
        >
          <Power aria-hidden />
          {offered ? 'Retire' : 'Offer to students'}
        </Button>
      </div>

      <ConfirmDialog
        open={asking === OFFERING_CONFIRMS.OFFER}
        onOpenChange={(open) => !open && setAsking(null)}
        title={`Offer ${detail.title ?? 'this test'} to students?`}
        description={offerDescription(detail)}
        confirmLabel="Offer to students"
        loading={offer.isPending}
        onConfirm={() => offer.mutate()}
      />

      <ConfirmDialog
        open={asking === OFFERING_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && setAsking(null)}
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

/** Offering is what freezes the paper, so the confirm has to say both things happen. */
function offerDescription(detail: TestDetail): string {
  const freeze = detail.isLocked
    ? ''
    : `Its ${plural(detail.totalQuestions, 'question')} freeze first, and every student sits exactly them. `;
  return `${freeze}Every student reached through ${plural(detail.seriesCount, 'series', 'series')} is offered it from now on.`;
}

/** What is still owed before a student can sit this. */
function PublishNotice({ detail }: Readonly<{ detail: TestDetail }>) {
  if (detail.isLocked) return null;

  const gaps = [
    detail.paperBinding === PAPER_BINDING.FIXED && detail.paperQuestionCount === 0
      ? 'Its paper has not been drawn yet.'
      : null,
    detail.seriesCount === 0 ? 'It is in no series, so no student can reach it.' : null,
  ].filter((gap): gap is string => gap !== null);

  if (gaps.length === 0) return null;

  return (
    <Alert variant="warning">
      <span className="flex flex-col gap-1">
        <span>This test is not ready to be offered.</span>
        {gaps.map((gap) => (
          <span key={gap}>{gap}</span>
        ))}
      </span>
    </Alert>
  );
}
