import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  AppException,
  DRAW_STRATEGIES,
  DRAW_STRATEGY,
  EVALUATION_MODE,
  EVALUATION_MODES,
  MAX_RETAKES_CEILING,
  PAPER_BINDING,
  TEST_SCOPE,
  TEST_SCOPES,
  allowedPaperBindings,
  type BaseConfigDetail,
  type DrawStrategy,
  type EvaluationMode,
  type PaperBinding,
  type TestDetail,
  type TestScope,
  type TestScopeRef,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  Card,
  Combobox,
  FormField,
  FormPanel,
  FormSection,
  Input,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  StatRow,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  DRAW_STRATEGY_HINTS,
  DRAW_STRATEGY_LABELS,
  EVALUATION_MODE_HINTS,
  EVALUATION_MODE_LABELS,
  LANGUAGE_CODE_LABELS,
  NAV_ITEMS,
  NAVIGATION_POLICY_LABELS,
  PAPER_BINDING_HINTS,
  PAPER_BINDING_LABELS,
  ROUTES,
  TEST_SCOPE_LABELS,
  TIMER_TEMPLATE_LABELS,
} from '../lib/constants';
import { durationLabel } from '../lib/duration';
import { ExamPicker, ExamStagePicker } from '../components/exam-picker';
import { BaseConfigPicker } from '../components/config-picker';
import { TopicMultiPicker } from '../components/taxonomy-picker';
import { OfferingStep, PaperStep } from './test-builder-steps';

/** Step 1 of the builder: which blueprint a test is built on, plus the few fields it owns. */

interface TestFormValues {
  examId: string;
  examStageId: string;
  baseConfigId: string;
  title: string;
  scope: TestScope;
  moduleId: string;
  sectionId: string;
  topicIds: string[];
  evaluationMode: EvaluationMode;
  paperBinding: PaperBinding;
  maxRetakes: string;
  drawStrategy: DrawStrategy;
}

function valuesOf(detail: TestDetail | null): TestFormValues {
  const scopeRef = detail?.scopeRef ?? null;
  return {
    examId: detail?.examStage.exam.id ?? '',
    examStageId: detail?.examStageId ?? '',
    baseConfigId: detail?.baseConfigId ?? '',
    title: detail?.title ?? '',
    scope: detail?.scope ?? TEST_SCOPE.FULL,
    moduleId: scopeRef?.moduleId ?? '',
    sectionId: scopeRef?.sectionId ?? '',
    topicIds: scopeRef?.topicIds ?? [],
    evaluationMode: detail?.evaluationMode ?? EVALUATION_MODE.RANKED,
    paperBinding: detail?.paperBinding ?? PAPER_BINDING.FIXED,
    maxRetakes: detail?.maxRetakes === null || detail === null ? '' : String(detail.maxRetakes),
    drawStrategy: detail?.drawStrategy ?? DRAW_STRATEGY.RANDOM,
  };
}

/** An empty reference is sent as none, so the server answers with the prompt naming what is missing. */
function scopeRefOf(values: TestFormValues): TestScopeRef | null {
  if (values.scope === TEST_SCOPE.MODULE) {
    return values.moduleId ? { moduleId: values.moduleId } : null;
  }
  if (values.scope === TEST_SCOPE.SECTIONAL) {
    return values.sectionId ? { sectionId: values.sectionId } : null;
  }
  if (values.scope === TEST_SCOPE.TOPIC) {
    return values.topicIds.length > 0 ? { topicIds: values.topicIds } : null;
  }
  return null;
}

/** The keys the server answers with. `scopeRef` has no control of its own — see `SCOPE_FIELDS`. */
const SERVER_FIELDS = ['baseConfigId', 'title', 'paperBinding', 'maxRetakes', 'scopeRef'] as const;

/** Which control a `scopeRef` error belongs on, since the reference is a different one per scope. */
const SCOPE_FIELDS: Readonly<Record<TestScope, keyof TestFormValues | null>> = {
  [TEST_SCOPE.FULL]: null,
  [TEST_SCOPE.MODULE]: 'moduleId',
  [TEST_SCOPE.SECTIONAL]: 'sectionId',
  [TEST_SCOPE.TOPIC]: 'topicIds',
};

function applyServerErrors(
  error: unknown,
  form: UseFormReturn<TestFormValues>,
  scope: TestScope,
): void {
  applyFieldErrors(error, form.setError, ['baseConfigId', 'title', 'paperBinding', 'maxRetakes']);
  const field = SCOPE_FIELDS[scope];
  if (!field || !AppException.is(error)) return;
  const message = error.fieldErrors?.scopeRef?.[0];
  if (message) form.setError(field, { type: 'server', message });
}

export function TestFormPage() {
  const { id } = useParams();
  const existing = id !== undefined;

  const test = useQuery({
    queryKey: ['admin', 'test', id],
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
  return <TestEditor detail={test.data ?? null} />;
}

function TestEditor({ detail }: Readonly<{ detail: TestDetail | null }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  const frozen = detail?.isLocked ?? false;

  const form = useForm<TestFormValues>({ defaultValues: valuesOf(detail) });
  const examId = useWatch({ control: form.control, name: 'examId' });
  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const baseConfigId = useWatch({ control: form.control, name: 'baseConfigId' });
  const scope = useWatch({ control: form.control, name: 'scope' });
  const evaluationMode = useWatch({ control: form.control, name: 'evaluationMode' });
  const paperBinding = useWatch({ control: form.control, name: 'paperBinding' });
  const drawStrategy = useWatch({ control: form.control, name: 'drawStrategy' });

  const chosenConfig = useQuery({
    queryKey: ['admin', 'base-config', baseConfigId],
    queryFn: () => api.admin.baseConfigs.detail(baseConfigId),
    enabled: !existing && baseConfigId !== '',
  });
  const config = detail?.baseConfig ?? chosenConfig.data ?? null;

  const save = useMutation({
    meta: { success: existing ? 'Test saved.' : 'Draft test created.' },
    mutationFn: (values: TestFormValues) => {
      const title = values.title.trim() || null;
      // A frozen test refuses everything else, so a rename must not carry the rest along with it.
      if (detail && frozen) return api.admin.tests.update(detail.id, { title });

      const owned = {
        title,
        scope: values.scope,
        scopeRef: scopeRefOf(values),
        evaluationMode: values.evaluationMode,
        paperBinding: values.paperBinding,
        maxRetakes: values.maxRetakes.trim() === '' ? null : Number(values.maxRetakes),
        drawStrategy: values.drawStrategy,
      };
      return detail
        ? api.admin.tests.update(detail.id, owned)
        : api.admin.tests.create({ ...owned, baseConfigId: values.baseConfigId });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'tests'] });
      navigate(ROUTES.TEST(saved.id));
    },
    onError: (error) => applyServerErrors(error, form, scope),
  });

  /** A cascade: a stage belongs to one exam, and a configuration to one stage. */
  const pickExam = (value: string) => {
    form.setValue('examId', value);
    form.setValue('examStageId', '');
    form.setValue('baseConfigId', '');
  };
  const pickStage = (value: string) => {
    form.setValue('examStageId', value);
    form.setValue('baseConfigId', '');
  };

  /** Ranked leaves only the frozen paper, so choosing it moves the binding rather than failing. */
  const pickEvaluationMode = (value: string) => {
    const mode = value as EvaluationMode;
    form.setValue('evaluationMode', mode);
    if (!allowedPaperBindings(mode).includes(paperBinding)) {
      form.setValue('paperBinding', PAPER_BINDING.FIXED);
    }
  };

  const banner = bannerMessage(save.error, [...SERVER_FIELDS]);

  return (
    <FormPanel
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        <>
          <Button type="button" variant="outline" asChild>
            <Link to={ROUTES.TESTS}>Cancel</Link>
          </Button>
          <Button type="submit" loading={save.isPending}>
            {existing ? 'Save test' : 'Create draft test'}
          </Button>
        </>
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={detail?.title ?? (existing ? 'Untitled test' : 'New test')}
            meta={detail ? `${detail.examStage.exam.code} / ${detail.examStage.name}` : undefined}
          />
          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    >
      {frozen ? (
        <Alert variant="warning">
          This test is finalized — its paper is frozen and students may already have sat it. Only
          its name can still be changed.
        </Alert>
      ) : null}

      <FormSection title="Which paper this is">
        <div className="grid gap-4 sm:grid-cols-2">
          {existing ? (
            <>
              <ReadOnlyField
                label="Stage"
                value={`${detail.examStage.exam.code} / ${detail.examStage.name}`}
              />
              <ReadOnlyField label="Base configuration" value={detail.baseConfigName} />
            </>
          ) : (
            <>
              <FormField form={form} name="examId" label="Exam">
                {(control) => (
                  <ExamPicker
                    id={control.id}
                    value={examId}
                    placeholder="Choose an exam"
                    clearable={false}
                    onChange={pickExam}
                  />
                )}
              </FormField>

              <FormField form={form} name="examStageId" label="Stage">
                {(control) => (
                  <ExamStagePicker
                    id={control.id}
                    examId={examId}
                    value={examStageId}
                    placeholder="Choose a stage"
                    clearable={false}
                    onChange={pickStage}
                  />
                )}
              </FormField>

              <FormField
                form={form}
                name="baseConfigId"
                label="Base configuration"
                hint="Only the ones still offered on this stage"
              >
                {(control) => (
                  <BaseConfigPicker
                    id={control.id}
                    examStageId={examStageId}
                    value={baseConfigId}
                    onChange={(value) => form.setValue('baseConfigId', value)}
                  />
                )}
              </FormField>
            </>
          )}

          <FormField form={form} name="title" label="Name">
            {(control) => <Input {...control} placeholder="SSC CGL Tier 1 — Mock 1" />}
          </FormField>
        </div>
      </FormSection>

      {config ? <InheritedShape config={config} /> : null}

      <FormSection title="How it is judged">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField form={form} name="scope" label="Covers">
            {(control) => (
              <Combobox
                id={control.id}
                value={scope}
                clearable={false}
                disabled={frozen}
                onChange={(value) => form.setValue('scope', value as TestScope)}
                items={TEST_SCOPES.map((value) => ({
                  value,
                  label: TEST_SCOPE_LABELS[value],
                }))}
              />
            )}
          </FormField>

          <ScopeReference form={form} scope={scope} config={config} disabled={frozen} />

          <FormField form={form} name="evaluationMode" label="Evaluation">
            {(control) => (
              <Combobox
                id={control.id}
                value={evaluationMode}
                clearable={false}
                disabled={frozen}
                onChange={pickEvaluationMode}
                items={EVALUATION_MODES.map((value) => ({
                  value,
                  label: EVALUATION_MODE_LABELS[value],
                  hint: EVALUATION_MODE_HINTS[value],
                }))}
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="paperBinding"
            label="Paper"
            hint={
              evaluationMode === EVALUATION_MODE.RANKED
                ? 'A ranked test needs one shared paper'
                : undefined
            }
          >
            {(control) => (
              <Combobox
                id={control.id}
                value={paperBinding}
                clearable={false}
                disabled={frozen}
                onChange={(value) => form.setValue('paperBinding', value as PaperBinding)}
                items={allowedPaperBindings(evaluationMode).map((value) => ({
                  value,
                  label: PAPER_BINDING_LABELS[value],
                  hint: PAPER_BINDING_HINTS[value],
                }))}
              />
            )}
          </FormField>

          <FormField form={form} name="maxRetakes" label="Retakes" hint="Blank means unlimited">
            {(control) => (
              <Input
                {...control}
                disabled={frozen}
                inputMode="numeric"
                placeholder={String(MAX_RETAKES_CEILING)}
              />
            )}
          </FormField>

          <FormField form={form} name="drawStrategy" label="Draw">
            {(control) => (
              <Combobox
                id={control.id}
                value={drawStrategy}
                clearable={false}
                disabled={frozen}
                onChange={(value) => form.setValue('drawStrategy', value as DrawStrategy)}
                items={DRAW_STRATEGIES.map((value) => ({
                  value,
                  label: DRAW_STRATEGY_LABELS[value],
                  hint: DRAW_STRATEGY_HINTS[value],
                }))}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      {detail ? (
        <>
          <PaperStep detail={detail} />
          <OfferingStep detail={detail} />
        </>
      ) : null}
    </FormPanel>
  );
}

/** The reference a scope needs. FULL covers the whole paper and names no part of it. */
function ScopeReference({
  form,
  scope,
  config,
  disabled,
}: Readonly<{
  form: UseFormReturn<TestFormValues>;
  scope: TestScope;
  config: BaseConfigDetail | null;
  disabled: boolean;
}>) {
  const moduleId = useWatch({ control: form.control, name: 'moduleId' });
  const sectionId = useWatch({ control: form.control, name: 'sectionId' });
  const topicIds = useWatch({ control: form.control, name: 'topicIds' });
  const subjectIds = (config?.sections ?? [])
    .map((section) => section.subjectId)
    .filter((id): id is string => id !== null);

  if (scope === TEST_SCOPE.MODULE) {
    return (
      <FormField form={form} name="moduleId" label="Module">
        {(control) => (
          <Combobox
            id={control.id}
            value={moduleId}
            clearable={false}
            disabled={disabled}
            placeholder="Choose a module"
            onChange={(value) => form.setValue('moduleId', value)}
            items={(config?.modules ?? []).map((module) => ({
              value: module.id,
              label: module.name,
            }))}
            emptyLabel="This configuration has no modules"
          />
        )}
      </FormField>
    );
  }

  if (scope === TEST_SCOPE.SECTIONAL) {
    return (
      <FormField form={form} name="sectionId" label="Section">
        {(control) => (
          <Combobox
            id={control.id}
            value={sectionId}
            clearable={false}
            disabled={disabled}
            placeholder="Choose a section"
            onChange={(value) => form.setValue('sectionId', value)}
            items={(config?.sections ?? []).map((section) => ({
              value: section.id,
              label: section.name,
              hint: plural(section.questionCount, 'question'),
            }))}
            emptyLabel="This configuration has no sections"
          />
        )}
      </FormField>
    );
  }

  if (scope === TEST_SCOPE.TOPIC) {
    return (
      <FormField form={form} name="topicIds" label="Topics">
        {(control) => (
          <TopicMultiPicker
            id={control.id}
            subjectIds={subjectIds}
            value={topicIds}
            placeholder="Choose topics"
            onChange={(next) => form.setValue('topicIds', next)}
          />
        )}
      </FormField>
    );
  }

  return null;
}

/** Read-only, because it is not this test's to change: it belongs to the configuration. */
function InheritedShape({ config }: Readonly<{ config: BaseConfigDetail }>) {
  return (
    <FormSection title="What it inherits">
      <Alert variant="info">
        Marks, timing, structure and languages all come from {config.name}. Change the configuration
        and every test built on it changes with it.
      </Alert>

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
        <StatRow label="Sections" value={config.sections.length} />
        <StatRow label="Questions" value={config.totalQuestions} />
        <StatRow label="Marks" value={config.totalMarks} />
        <StatRow label="Duration" value={durationLabel(config.durationSec)} />
        <StatRow label="Timing pattern" value={TIMER_TEMPLATE_LABELS[config.timerTemplate]} />
        <StatRow label="Navigation" value={NAVIGATION_POLICY_LABELS[config.navigation]} />
        <StatRow
          label="Languages"
          value={config.languages.map((code) => LANGUAGE_CODE_LABELS[code]).join(', ') || '—'}
        />
      </div>

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {config.sections.map((section) => (
          <StatRow
            key={section.id}
            label={section.name}
            value={`${plural(section.questionCount, 'question')} · ${section.marksPerQuestion} each, −${section.negativeMarks}`}
          />
        ))}
      </div>
    </FormSection>
  );
}

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="flex h-9 items-center text-sm text-muted-foreground">{value}</span>
    </div>
  );
}
