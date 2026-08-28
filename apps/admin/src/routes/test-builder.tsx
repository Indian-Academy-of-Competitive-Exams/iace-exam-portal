import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  PAPER_BINDING,
  type PaperBinding,
  TEST_BUILDER_STEP,
  TEST_BUILDER_STEPS,
  testBuilderStepOf,
  type BaseConfigDetail,
  type DrawSpec,
  type TestBuilderStep,
  type TestDetail,
} from '@iace/contracts';
import { bannerMessage, isNotNumeric, optionalNumber } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  Card,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  STEPPER_STATES,
  Stepper,
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
  RETAKES_NOT_A_NUMBER,
  scopeRefOf,
  SERVER_FIELDS,
  valuesOf,
  type TestFormValues,
} from './test-builder-form';
import { SetupStep } from './test-builder-setup';
import { PaperStep } from './test-builder-paper';
import { BranchTimingStep, PublishStep, SeriesStep } from './test-builder-offering';

/** The builder shell: which phase you are in, and the Next that saves the one you are leaving. */

const TEST_KEY = (testId: string) => [...QUERY_KEYS.TEST, testId] as const;

/** The steps the form itself owns — the only ones whose Next has anything to save. */
const FIELD_STEPS: ReadonlySet<TestBuilderStep> = new Set([
  TEST_BUILDER_STEP.SETUP,
  TEST_BUILDER_STEP.PAPER,
]);

/** Each step is done when the thing it exists to produce is there, not when it has been walked past. */
function doneSteps(detail: TestDetail | null): ReadonlySet<TestBuilderStep> {
  const done = new Set<TestBuilderStep>();
  if (!detail) return done;
  done.add(TEST_BUILDER_STEP.SETUP);
  if (detail.paperBinding === PAPER_BINDING.GENERATED || detail.paperQuestionCount > 0) {
    done.add(TEST_BUILDER_STEP.PAPER);
  }
  if (detail.isLocked) done.add(TEST_BUILDER_STEP.OFFER);
  return done;
}

export function TestBuilderPage() {
  const { id } = useParams();
  const existing = id !== undefined;

  const test = useQuery({
    queryKey: TEST_KEY(id ?? ''),
    queryFn: () => api.admin.tests.detail(id!),
    enabled: existing,
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
    return <Alert variant="danger">Could not load this test.</Alert>;
  }

  // Mounted only once the saved test is here, so a refetch cannot throw away a half-typed edit.
  return <TestBuilder detail={test.data ?? null} />;
}

function TestBuilder({ detail }: Readonly<{ detail: TestDetail | null }>) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  const sat = (detail?.attemptCount ?? 0) > 0;

  const form = useForm<TestFormValues>({ defaultValues: valuesOf(detail) });
  const baseConfigId = useWatch({ control: form.control, name: 'baseConfigId' });
  const scope = useWatch({ control: form.control, name: 'scope' });
  const drawSpec = useWatch({ control: form.control, name: 'drawSpec' });
  const paperBinding = useWatch({ control: form.control, name: 'paperBinding' });

  const arrivedAt = (location.state as { step?: TestBuilderStep } | null)?.step;
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
        evaluationMode: values.evaluationMode,
        paperBinding: values.paperBinding,
        maxRetakes: optionalNumber(values.maxRetakes),
        variantCount: optionalNumber(values.variantCount),
        drawStrategy: values.drawStrategy,
        questionPoolFilter: values.drawSpec,
      };
      return detail
        ? api.admin.tests.update(detail.id, owned)
        : api.admin.tests.create({ ...owned, baseConfigId: values.baseConfigId });
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

  /** Blank is unlimited, so text that is not a number would save AS unlimited without this. */
  const saveThenOpen = (target: TestBuilderStep) =>
    form.handleSubmit((values) => {
      if (isNotNumeric(values.maxRetakes)) {
        form.setError('maxRetakes', { type: 'validate', message: RETAKES_NOT_A_NUMBER });
        return;
      }
      save.mutate({ values, target });
    })();

  /** Leaving a step the form owns saves it first, so no move can quietly drop what was typed. */
  const open = (target: TestBuilderStep) => {
    if (target === step) return;
    const pending = !existing || form.formState.isDirty;
    if (FIELD_STEPS.has(step) && pending) {
      saveThenOpen(target);
      return;
    }
    setStep(target);
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
        config={config}
        sat={sat}
        spec={drawSpec}
        onSpec={(next) => form.setValue('drawSpec', next, { shouldDirty: true })}
        paperBinding={paperBinding}
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
}: Readonly<{
  previous: TestBuilderStep | null;
  next: TestBuilderStep | null;
  saving: boolean;
  onOpen: (target: TestBuilderStep) => void;
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
          <Link to={ROUTES.TESTS}>Done</Link>
        </Button>
      )}
    </>
  );
}

function StepBody({
  step,
  form,
  detail,
  config,
  sat,
  spec,
  onSpec,
  paperBinding,
}: Readonly<{
  step: TestBuilderStep;
  form: UseFormReturn<TestFormValues>;
  detail: TestDetail | null;
  config: BaseConfigDetail | null;
  sat: boolean;
  spec: DrawSpec;
  onSpec: (next: DrawSpec) => void;
  /** From the FORM, not the record: the step shows what was chosen, not what was last saved. */
  paperBinding: PaperBinding;
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
        <SetupStep form={form} detail={detail} config={config} sat={sat} />
      ) : null}
      {detail && step === TEST_BUILDER_STEP.PAPER ? (
        <PaperStep detail={detail} spec={spec} onSpec={onSpec} paperBinding={paperBinding} />
      ) : null}
      {detail && step === TEST_BUILDER_STEP.OFFER ? (
        <>
          <SeriesStep detail={detail} />
          <BranchTimingStep detail={detail} />
          <PublishStep detail={detail} />
        </>
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
