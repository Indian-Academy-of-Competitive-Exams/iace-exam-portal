import { useWatch } from 'react-hook-form';
import {
  EVALUATION_MODE,
  EVALUATION_MODE_LABELS,
  EVALUATION_MODES,
  EXAM_TEMPLATE,
  EXAM_TEMPLATES,
  MAX_PAPER_VARIANTS,
  MIN_PAPER_VARIANTS,
  MAX_RETAKES_CEILING,
  PAPER_BINDING,
  PAPER_BINDINGS,
  TEST_SCOPE,
  TEST_SCOPES,
  TEST_SCOPE_LABELS,
  allowedPaperBindings,
  type BaseConfigDetail,
  type EvaluationMode,
  type ExamTemplate,
  type PaperBinding,
  type TestDetail,
  type TestScope,
} from '@iace/contracts';
import {
  Combobox,
  FormField,
  FormSection,
  Input,
  RadioGroup,
  RadioGroupItem,
  plural,
} from '@iace/ui';
import {
  EVALUATION_MODE_HINTS,
  EXAM_TEMPLATE_LABELS,
  PAPER_BINDING_HINTS,
  PAPER_BINDING_LABELS,
} from '../lib/constants';
import { ExamPicker, ExamStagePicker } from '../components/exam-picker';
import { BaseConfigPicker } from '../components/config-picker';
import { ExamTemplatePreview } from '../components/exam-template-preview';
import { NO_SERIES, TestSeriesPicker, type ChosenSeries } from '../components/access-picker';
import { useSuggestedTestName } from '../lib/use-suggested-name';
import { type TestForm, type TestFormValues } from './test-builder-form';

/** Everything a test writes itself: the blueprint it is built on, and how it is judged. */

// Only a dirty form makes leaving Setup save before it moves, so every pick here must mark one.
const DIRTY = { shouldDirty: true } as const;

// A disabled control never fires, but the prop is required.
const noop = () => undefined;

export function SetupStep({
  form,
  detail,
  config,
  sat,
}: Readonly<{
  form: TestForm;
  detail: TestDetail | null;
  config: BaseConfigDetail | null;
  sat: boolean;
}>) {
  const values = useWatch({ control: form.control }) as TestFormValues;
  const suggested = useSuggestedTestName({
    examCode: config?.examStage.exam.code,
    stageName: config?.examStage.name,
    configName: config?.name,
    examStageId: config?.examStageId,
    scope: values.scope,
    evaluationMode: values.evaluationMode || undefined,
    scopeName: scopeNameOf(values, config),
  });

  return (
    <>
      <FormSection title="Paper">
        <Blueprint
          form={form}
          detail={detail}
          config={config}
          suggestion={values.title?.trim() === '' ? suggested : undefined}
        />
      </FormSection>

      <FormSection title="Scoring">
        <Rules form={form} config={config} sat={sat} />
      </FormSection>
    </>
  );
}

/** A topic's name lives on the taxonomy rather than the config, so a topic test keeps the fallback. */
function scopeNameOf(values: TestFormValues, config: BaseConfigDetail | null): string | null {
  if (!config) return null;
  if (values.scope === TEST_SCOPE.SECTIONAL) {
    return config.sections.find((section) => section.id === values.sectionId)?.name ?? null;
  }
  if (values.scope === TEST_SCOPE.MODULE) {
    return config.modules.find((module) => module.id === values.moduleId)?.name ?? null;
  }
  return null;
}

function Blueprint({
  form,
  detail,
  config,
  suggestion,
}: Readonly<{
  form: TestForm;
  detail: TestDetail | null;
  config: BaseConfigDetail | null;
  suggestion?: string;
}>) {
  const examId = useWatch({ control: form.control, name: 'examId' });
  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const baseConfigId = useWatch({ control: form.control, name: 'baseConfigId' });
  const testSeriesId = useWatch({ control: form.control, name: 'testSeriesId' });
  const testSeriesName = useWatch({ control: form.control, name: 'testSeriesName' });
  const chosen = useWatch({ control: form.control, name: 'examTemplate' });
  // Unchosen shows what the blueprint would give, which is exactly what the server would store.
  const examTemplate = chosen ?? config?.examTemplate ?? EXAM_TEMPLATE.DEFAULT;

  /** The series decides the mode, and a ranked one leaves only the frozen paper. */
  const pickSeries = (series: ChosenSeries) => {
    const mode = series.id === '' ? '' : series.evaluationMode;
    form.setValue('testSeriesId', series.id, DIRTY);
    form.setValue('testSeriesName', series.name, DIRTY);
    form.setValue('evaluationMode', mode, DIRTY);
    if (mode && !allowedPaperBindings(mode).includes(form.getValues('paperBinding'))) {
      form.setValue('paperBinding', PAPER_BINDING.FIXED, DIRTY);
    }
  };

  /** A cascade: a stage belongs to one exam, and both a configuration and a series to one stage. */
  const pickExam = (value: string) => {
    form.setValue('examId', value, DIRTY);
    form.setValue('examStageId', '', DIRTY);
    form.setValue('baseConfigId', '', DIRTY);
    pickSeries(NO_SERIES);
  };
  const pickStage = (value: string) => {
    form.setValue('examStageId', value, DIRTY);
    form.setValue('baseConfigId', '', DIRTY);
    pickSeries(NO_SERIES);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {detail ? (
        <>
          <ReadOnlyField
            label="Stage"
            value={`${detail.examStage.exam.code} / ${detail.examStage.name}`}
          />
          <ReadOnlyField label="Base configuration" value={detail.baseConfigName} />

          <FormField
            form={form}
            name="testSeriesId"
            label="Series"
            /* ui-copy-ok: rule */ hint="Changed on the Offer step, where a move is confirmed"
          >
            {(control) => (
              <TestSeriesPicker
                id={control.id}
                value={testSeriesId}
                selectedLabel={testSeriesName || undefined}
                clearable={false}
                disabled
                forExamStageId={detail.examStageId}
                onChange={pickSeries}
              />
            )}
          </FormField>
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

          <FormField form={form} name="baseConfigId" label="Base configuration">
            {(control) => (
              <BaseConfigPicker
                id={control.id}
                examStageId={examStageId}
                value={baseConfigId}
                onChange={(value) => form.setValue('baseConfigId', value, DIRTY)}
              />
            )}
          </FormField>

          <FormField form={form} name="testSeriesId" label="Series">
            {(control) => (
              <TestSeriesPicker
                id={control.id}
                value={testSeriesId}
                selectedLabel={testSeriesName || undefined}
                placeholder="Choose a series"
                clearable={false}
                forExamStageId={examStageId}
                onChange={pickSeries}
              />
            )}
          </FormField>
        </>
      )}

      <FormField form={form} name="title" label="Name">
        {(control) => (
          <Input
            {...control}
            placeholder="SSC CGL Tier 1 Standard — Mock 01"
            suggestion={suggestion}
            onAcceptSuggestion={(name) =>
              form.setValue('title', name, { shouldDirty: true, shouldValidate: true })
            }
          />
        )}
      </FormField>

      <FormField form={form} name="examTemplate" label="Exam template" className="sm:col-span-2">
        {(control) => (
          <RadioGroup
            name={control.name}
            legend="Exam template"
            hideLegend
            value={examTemplate}
            onValueChange={(next) => form.setValue('examTemplate', next as ExamTemplate, DIRTY)}
            className="grid max-w-2xl gap-3 sm:grid-cols-2"
          >
            {EXAM_TEMPLATES.map((value) => (
              <RadioGroupItem
                key={value}
                id={`${control.id}-${value}`}
                value={value}
                className="rounded-lg border border-border p-3 has-[input:checked]:border-primary"
                label={
                  <span className="flex flex-col gap-2">
                    <span className="font-medium">{EXAM_TEMPLATE_LABELS[value]}</span>
                    <ExamTemplatePreview template={value} />
                  </span>
                }
              />
            ))}
          </RadioGroup>
        )}
      </FormField>
    </div>
  );
}

/** An unchosen series has no mode to narrow by, so nothing is ruled out until one is picked. */
const bindingsFor = (evaluationMode: EvaluationMode | ''): readonly PaperBinding[] =>
  evaluationMode ? allowedPaperBindings(evaluationMode) : PAPER_BINDINGS;

function Rules({
  form,
  config,
  sat,
}: Readonly<{
  form: TestForm;
  config: BaseConfigDetail | null;
  sat: boolean;
}>) {
  const scope = useWatch({ control: form.control, name: 'scope' });
  const evaluationMode = useWatch({ control: form.control, name: 'evaluationMode' });
  const paperBinding = useWatch({ control: form.control, name: 'paperBinding' });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField
        form={form}
        name="evaluationMode"
        label="Evaluation"
        /* ui-copy-ok: rule */ hint="Set by the series this test belongs to"
      >
        {(control) => (
          <Combobox
            id={control.id}
            value={evaluationMode}
            placeholder="Set by its series"
            clearable={false}
            disabled
            onChange={noop}
            items={EVALUATION_MODES.map((value) => ({
              value,
              label: EVALUATION_MODE_LABELS[value],
              hint: EVALUATION_MODE_HINTS[value],
            }))}
          />
        )}
      </FormField>

      <FormField form={form} name="scope" label="Covers">
        {(control) => (
          <Combobox
            id={control.id}
            value={scope}
            clearable={false}
            disabled={sat}
            onChange={(value) => form.setValue('scope', value as TestScope, DIRTY)}
            items={TEST_SCOPES.map((value) => ({ value, label: TEST_SCOPE_LABELS[value] }))}
          />
        )}
      </FormField>

      <ScopeReference form={form} scope={scope} config={config} disabled={sat} />

      <FormField
        form={form}
        name="paperBinding"
        label="Paper"
        /* ui-copy-ok: rule */ hint={
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
            disabled={sat}
            onChange={(value) => form.setValue('paperBinding', value as PaperBinding, DIRTY)}
            items={bindingsFor(evaluationMode).map((value) => ({
              value,
              label: PAPER_BINDING_LABELS[value],
              hint: PAPER_BINDING_HINTS[value],
            }))}
          />
        )}
      </FormField>

      <FormField
        form={form}
        name="maxRetakes"
        label="Retakes"
        /* ui-copy-ok: limit */ hint="Blank means unlimited"
      >
        {(control) => (
          <Input
            {...control}
            disabled={sat}
            inputMode="numeric"
            placeholder={String(MAX_RETAKES_CEILING)}
          />
        )}
      </FormField>

      {paperBinding === PAPER_BINDING.GENERATED ? (
        <FormField
          form={form}
          name="variantCount"
          label="Papers"
          /* ui-copy-ok: limit */ hint={`${MIN_PAPER_VARIANTS} to ${MAX_PAPER_VARIANTS}`}
        >
          {(control) => <Input {...control} disabled={sat} inputMode="numeric" />}
        </FormField>
      ) : null}
    </div>
  );
}

/** The reference a scope needs. FULL covers the whole paper and names no part of it. */
function ScopeReference({
  form,
  scope,
  config,
  disabled,
}: Readonly<{
  form: TestForm;
  scope: TestScope;
  config: BaseConfigDetail | null;
  disabled: boolean;
}>) {
  const moduleId = useWatch({ control: form.control, name: 'moduleId' });
  const sectionId = useWatch({ control: form.control, name: 'sectionId' });

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
            onChange={(value) => form.setValue('moduleId', value, DIRTY)}
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
            onChange={(value) => form.setValue('sectionId', value, DIRTY)}
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

  return null;
}

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="flex h-9 items-center text-sm text-muted-foreground">{value}</span>
    </div>
  );
}
