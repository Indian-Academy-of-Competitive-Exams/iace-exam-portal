import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dices, Lock, Power } from 'lucide-react';
import {
  AppException,
  ErrorCodes,
  PAPER_BINDING,
  TEST_STATUS,
  type BaseConfigSection,
  type TestDetail,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  FormSection,
  SkeletonParagraph,
  StatRow,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { TEST_STATUS_LABELS } from '../lib/constants';
import { QuestionMultiPicker } from '../components/question-picker';
import { TestSeriesMultiPicker } from '../components/access-picker';

/** Steps 2 and 3 of the builder: what the paper holds, and who is offered it. */

const PAPER_KEY = (testId: string) => ['admin', 'test-paper', testId] as const;
const SERIES_KEY = (testId: string) => ['admin', 'test-series-links', testId] as const;

/** A draw that could not fill a section answers with one message per section id. */
function shortfallsOf(error: unknown): string[] {
  if (!AppException.is(error) || error.code !== ErrorCodes.DRAW_SHORTFALL) return [];
  return Object.values(error.fieldErrors ?? {}).flat();
}

export function PaperStep({ detail }: Readonly<{ detail: TestDetail }>) {
  const queryClient = useQueryClient();
  const [manual, setManual] = useState<Record<string, string[]>>({});
  const generated = detail.paperBinding === PAPER_BINDING.GENERATED;

  const paper = useQuery({
    queryKey: PAPER_KEY(detail.id),
    queryFn: () => api.admin.tests.readPaper(detail.id),
    enabled: !generated,
  });

  const draw = useMutation({
    meta: { success: 'Paper drawn.' },
    mutationFn: () =>
      api.admin.tests.assemblePaper(detail.id, {
        manual: Object.entries(manual)
          .filter(([, questionIds]) => questionIds.length > 0)
          .map(([baseConfigSectionId, questionIds]) => ({ baseConfigSectionId, questionIds })),
      }),
    onSuccess: (next) => queryClient.setQueryData(PAPER_KEY(detail.id), next),
  });

  const held = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of paper.data?.sections ?? []) {
      counts.set(section.baseConfigSectionId, section.questions.length);
    }
    return counts;
  }, [paper.data]);

  if (generated) {
    return (
      <FormSection title="The paper">
        <Alert variant="info">
          This test draws a fresh paper for each student when their attempt starts, so there is no
          one paper to build here. Switch it to a fixed paper above if every student should sit the
          same questions.
        </Alert>
      </FormSection>
    );
  }

  const gaps = shortfallsOf(draw.error);
  const drawn = [...held.values()].reduce((sum, count) => sum + count, 0);

  return (
    <FormSection title="The paper" meta={`${drawn} of ${detail.totalQuestions} drawn`}>
      {gaps.length > 0 ? (
        <Alert variant="warning">
          <span className="flex flex-col gap-1">
            <span>The bank cannot fill this paper yet, so nothing was drawn.</span>
            {gaps.map((gap) => (
              <span key={gap}>{gap}</span>
            ))}
          </span>
        </Alert>
      ) : null}

      {detail.isLocked ? (
        <Alert variant="info">
          This paper is frozen. Every student sits exactly these questions, in this order.
        </Alert>
      ) : null}

      {paper.isLoading ? <SkeletonParagraph lines={detail.baseConfig.sections.length} /> : null}

      <div className="flex flex-col gap-4">
        {paper.isLoading
          ? null
          : detail.baseConfig.sections.map((section) => (
              <SectionRow
                key={section.id}
                section={section}
                held={held.get(section.id) ?? 0}
                pinned={manual[section.id] ?? []}
                frozen={detail.isLocked}
                onPin={(next) => setManual((held) => ({ ...held, [section.id]: next }))}
              />
            ))}
      </div>

      {drawn > 0 && !detail.isLocked ? (
        <Alert variant="info">
          Drawing again replaces every question below, keeping only what you have chosen by hand.
        </Alert>
      ) : null}

      {detail.isLocked ? null : (
        <Button type="button" onClick={() => draw.mutate()} loading={draw.isPending}>
          <Dices aria-hidden />
          {drawn > 0 ? 'Draw again' : 'Draw the paper'}
        </Button>
      )}
    </FormSection>
  );
}

function SectionRow({
  section,
  held,
  pinned,
  frozen,
  onPin,
}: Readonly<{
  section: BaseConfigSection;
  held: number;
  pinned: readonly string[];
  frozen: boolean;
  onPin: (next: string[]) => void;
}>) {
  const short = held < section.questionCount;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatRow
        label={section.name}
        value={
          <span className="inline-flex items-center gap-2">
            <span>{`${held} of ${section.questionCount}`}</span>
            {short ? <Badge variant="warning">Short</Badge> : <Badge variant="success">Full</Badge>}
          </span>
        }
      />
      <Field htmlFor={`pin-${section.id}`} label="Choose by hand" hint="The draw fills the rest">
        {(control) => (
          <QuestionMultiPicker
            {...control}
            subjectId={section.subjectId}
            value={pinned}
            disabled={frozen}
            onChange={onPin}
          />
        )}
      </Field>
    </div>
  );
}

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
            onClick={() => setStatus.mutate(offered ? TEST_STATUS.INACTIVE : TEST_STATUS.ACTIVE)}
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
