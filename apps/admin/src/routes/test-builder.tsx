import { useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  TEST_BUILDER_STEP,
  TEST_BUILDER_STEPS,
  testBuilderStepOf,
  owesAPaper,
  type BaseConfigDetail,
  type TestBuilderStep,
  type TestDetail,
  type TestSeriesSummary,
} from '@iace/contracts';
import { bannerMessage, optionalNumber } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  EmptyState,
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  Card,
  ConfirmDialog,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  STEPPER_STATES,
  Stepper,
  plural,
  type StepperStep,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  NAV_ITEMS,
  QUERY_KEYS,
  ROUTES,
  TEST_BUILDER_STEP_LABELS,
  TEST_STATUS_LABELS,
} from '../lib/constants';
import { ConfigSummaryButton } from '../components/config-summary';
import {
  applyServerErrors,
  scopeRefOf,
  SERVER_FIELDS,
  valuesOf,
  type TestFormValues,
} from './test-builder-form';
import { SetupStep } from './test-builder-setup';
import { PaperStep } from './test-builder-paper-step';
import { OfferStep } from './test-builder-offering';
import {
  changesOf,
  savedSchedule,
  type ScheduleDraft,
  type ScheduleHold,
} from './test-schedule-draft';

/** The builder shell: which phase you are in, and the Next that saves the one you are leaving. */

const TEST_KEY = (testId: string) => [...QUERY_KEYS.TEST, testId] as const;

/** Each step is done when the thing it exists to produce is there, not when it has been walked past. */
function doneSteps(detail: TestDetail | null): ReadonlySet<TestBuilderStep> {
  const done = new Set<TestBuilderStep>();
  if (!detail) return done;
  done.add(TEST_BUILDER_STEP.SETUP);
  if (!owesAPaper(detail)) done.add(TEST_BUILDER_STEP.PAPER);
  if (detail.isLocked) done.add(TEST_BUILDER_STEP.OFFER);
  return done;
}

export function TestBuilderPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const existing = id !== undefined;
  const testId = id ?? '';
  // Built from inside a series: it names the series, and with it the mode and often the stage.
  const fromSeriesId = existing ? null : search.get('series');

  const test = useQuery({
    queryKey: TEST_KEY(testId),
    queryFn: () => api.admin.tests.detail(testId),
    enabled: existing,
  });

  const fromSeries = useQuery({
    queryKey: [...QUERY_KEYS.TEST_SERIES, fromSeriesId ?? ''],
    queryFn: () => api.admin.testSeries.detail(fromSeriesId ?? ''),
    enabled: fromSeriesId !== null,
  });

  if (existing && test.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={5} />
        </Card>
      </div>
    );
  }

  if (existing && (test.error || !test.data)) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this test"
        onRetry={test.refetch}
      />
    );
  }

  // Held until the series is here: `useForm` reads its defaults once, so a late arrival is ignored.
  if (fromSeriesId !== null && fromSeries.isLoading) return <SkeletonParagraph lines={5} />;

  // Mounted only once the saved test is here, so a refetch cannot throw away a half-typed edit.
  return <TestBuilder detail={test.data ?? null} fromSeries={fromSeries.data ?? null} />;
}

function TestBuilder({
  detail,
  fromSeries,
}: Readonly<{ detail: TestDetail | null; fromSeries: TestSeriesSummary | null }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  const sat = (detail?.attemptCount ?? 0) > 0;

  const form = useForm<TestFormValues>({ defaultValues: valuesOf(detail, fromSeries) });
  const baseConfigId = useWatch({ control: form.control, name: 'baseConfigId' });
  const scope = useWatch({ control: form.control, name: 'scope' });

  const arrivedAt = (location.state as { step?: TestBuilderStep } | null)?.step;
  // Landing on Offer past a half-built paper reads as though the paper were somebody else's problem.
  const [step, setStep] = useState<TestBuilderStep>(
    arrivedAt ?? (detail ? testBuilderStepOf(detail) : TEST_BUILDER_STEP.SETUP),
  );

  const chosenConfig = useQuery({
    queryKey: [...QUERY_KEYS.BASE_CONFIG, baseConfigId],
    queryFn: () => api.admin.baseConfigs.detail(baseConfigId),
    enabled: !existing && baseConfigId !== '',
  });
  const config = detail?.baseConfig ?? chosenConfig.data ?? null;

  const save = useMutation({
    meta: { success: existing ? 'Test saved.' : 'Draft test created.' },
    mutationFn: ({ values }: { values: TestFormValues; target: TestBuilderStep }) => {
      const title = values.title.trim();
      // A sat test refuses everything else, so a rename must not carry the rest along with it.
      if (detail && sat) return api.admin.tests.update(detail.id, { title });

      const owned = {
        title,
        scope: values.scope,
        scopeRef: scopeRefOf(values),
        paperBinding: values.paperBinding,
        // Left out while unchosen, so the server takes the config's rather than guessing here.
        examTemplate: values.examTemplate ?? undefined,
        variantCount: optionalNumber(values.variantCount),
      };
      return detail
        ? api.admin.tests.update(detail.id, owned)
        : api.admin.tests.create({
            ...owned,
            baseConfigId: values.baseConfigId,
            testSeriesId: values.testSeriesId,
          });
    },
    onSuccess: async (saved, { target }) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
      if (!existing) {
        navigate(ROUTES.TEST(saved.id), { replace: true, state: { step: target } });
        return;
      }
      queryClient.setQueryData(TEST_KEY(saved.id), saved);
      form.reset(form.getValues());
      setStep(target);
    },
    onError: (error) => applyServerErrors(error, form, scope),
  });

  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [discarding, setDiscarding] = useState<{ count: number; move: () => void } | null>(null);
  const schedule: ScheduleHold = {
    draft: scheduleDraft,
    onDraft: setScheduleDraft,
    unsaved: detail && scheduleDraft ? changesOf(savedSchedule(detail), scheduleDraft).count : 0,
  };

  const saveThenOpen = (target: TestBuilderStep) =>
    form.handleSubmit((values) => save.mutate({ values, target }))();

  const leaveSchedule = (move: () => void) => {
    if (schedule.unsaved > 0) {
      setDiscarding({ count: schedule.unsaved, move });
      return;
    }
    setScheduleDraft(null);
    move();
  };

  /** Leaving Setup saves it first and leaving Offer asks first, so no move quietly drops what was typed. */
  const open = (target: TestBuilderStep) => {
    if (target === step) return;
    const pending = !existing || form.formState.isDirty;
    if (step === TEST_BUILDER_STEP.SETUP && pending) {
      saveThenOpen(target);
      return;
    }
    leaveSchedule(() => setStep(target));
  };

  const finish = (event: MouseEvent<HTMLAnchorElement>) => {
    if (schedule.unsaved === 0) return;
    event.preventDefault();
    setDiscarding({ count: schedule.unsaved, move: () => navigate(ROUTES.TESTS) });
  };

  const done = doneSteps(detail);
  const steps: StepperStep[] = TEST_BUILDER_STEPS.map((value) => ({
    value,
    label: TEST_BUILDER_STEP_LABELS[value],
    state: stateOf(value, step, done),
    disabled: !existing && value !== TEST_BUILDER_STEP.SETUP,
  }));

  const index = TEST_BUILDER_STEPS.indexOf(step);
  const previous = TEST_BUILDER_STEPS[index - 1] ?? null;
  const next = TEST_BUILDER_STEPS[index + 1] ?? null;
  const banner = bannerMessage(save.error, [...SERVER_FIELDS]);

  return (
    <FormPanel
      onSubmit={(event) => {
        event.preventDefault();
        if (next) open(next);
      }}
      footer={
        <BuilderFooter
          previous={existing ? previous : null}
          next={next}
          saving={save.isPending}
          onOpen={open}
          onDone={finish}
        />
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={detail?.title ?? (existing ? 'Untitled test' : 'New test')}
            meta={metaOf(detail)}
            action={config ? <ConfigSummaryButton config={config} /> : undefined}
          />

          <Stepper
            className="mb-4"
            label="Building this test"
            steps={steps}
            onValueChange={(value) => open(value as TestBuilderStep)}
          />

          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    >
      <StepBody
        step={step}
        form={form}
        detail={detail}
        fromSeries={fromSeries}
        config={config}
        sat={sat}
        schedule={schedule}
      />

      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(isOpen) => !isOpen && setDiscarding(null)}
        destructive
        title="Discard the schedule changes?"
        description={`${plural(discarding?.count ?? 0, 'unsaved change')} to when this test opens will be dropped. The test keeps the schedule already saved.`}
        confirmLabel="Discard changes"
        onConfirm={() => {
          setScheduleDraft(null);
          discarding?.move();
          setDiscarding(null);
        }}
      />
    </FormPanel>
  );
}

function metaOf(detail: TestDetail | null) {
  if (!detail) return undefined;
  const { exam, name } = detail.examStage;
  return `${exam.code} / ${name} · ${TEST_STATUS_LABELS[detail.status]}`;
}

function BuilderFooter({
  previous,
  next,
  saving,
  onOpen,
  onDone,
}: Readonly<{
  previous: TestBuilderStep | null;
  next: TestBuilderStep | null;
  saving: boolean;
  onOpen: (target: TestBuilderStep) => void;
  onDone: (event: MouseEvent<HTMLAnchorElement>) => void;
}>) {
  return (
    <>
      {previous ? (
        <Button type="button" variant="outline" onClick={() => onOpen(previous)}>
          Back
        </Button>
      ) : (
        <Button type="button" variant="outline" asChild>
          <Link to={ROUTES.TESTS}>Cancel</Link>
        </Button>
      )}

      {next ? (
        <Button type="button" loading={saving} onClick={() => onOpen(next)}>
          Next
        </Button>
      ) : (
        <Button type="button" asChild>
          <Link to={ROUTES.TESTS} onClick={onDone}>
            Done
          </Link>
        </Button>
      )}
    </>
  );
}

function StepBody({
  step,
  form,
  detail,
  fromSeries,
  config,
  sat,
  schedule,
}: Readonly<{
  step: TestBuilderStep;
  form: UseFormReturn<TestFormValues>;
  detail: TestDetail | null;
  fromSeries: TestSeriesSummary | null;
  config: BaseConfigDetail | null;
  sat: boolean;
  schedule: ScheduleHold;
}>) {
  return (
    <>
      {sat ? (
        <Alert variant="warning">
          Students have sat this test, so its paper cannot move under their results. Only its name
          can still be changed.
        </Alert>
      ) : null}

      {step === TEST_BUILDER_STEP.SETUP ? (
        <SetupStep form={form} detail={detail} fromSeries={fromSeries} config={config} sat={sat} />
      ) : null}

      {step === TEST_BUILDER_STEP.PAPER ? <PaperStep detail={detail} config={config} /> : null}
      {detail && step === TEST_BUILDER_STEP.OFFER ? (
        <OfferStep detail={detail} schedule={schedule} />
      ) : null}
    </>
  );
}

function stateOf(
  value: TestBuilderStep,
  open: TestBuilderStep,
  done: ReadonlySet<TestBuilderStep>,
) {
  if (value === open) return STEPPER_STATES.CURRENT;
  return done.has(value) ? STEPPER_STATES.DONE : STEPPER_STATES.TODO;
}
