import { useWatch } from 'react-hook-form';
import {
  DRAW_STRATEGIES,
  EVALUATION_MODE,
  EVALUATION_MODES,
  MAX_PAPER_VARIANTS,
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
} from '@iace/contracts';
import { Combobox, FormField, FormSection, Input, plural } from '@iace/ui';
import {
  DRAW_STRATEGY_HINTS,
  DRAW_STRATEGY_LABELS,
  EVALUATION_MODE_HINTS,
  EVALUATION_MODE_LABELS,
  PAPER_BINDING_HINTS,
  PAPER_BINDING_LABELS,
  TEST_SCOPE_LABELS,
} from '../lib/constants';
import { ExamPicker, ExamStagePicker } from '../components/exam-picker';
import { BaseConfigPicker } from '../components/config-picker';
import { TopicMultiPicker } from '../components/taxonomy-picker';
import { useSuggestedTestName } from '../lib/use-suggested-name';
import { type TestForm, type TestFormValues } from './test-builder-form';

/** Everything a test writes itself: the blueprint it is built on, and how it is judged. */

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
    evaluationMode: values.evaluationMode,
    scopeName: scopeNameOf(values, config),
  });

  return (
    <>
      <FormSection title="Paper">
        <Blueprint
          form={form}
          detail={detail}
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
  suggestion,
}: Readonly<{ form: TestForm; detail: TestDetail | null; suggestion?: string }>) {
  const examId = useWatch({ control: form.control, name: 'examId' });
  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const baseConfigId = useWatch({ control: form.control, name: 'baseConfigId' });

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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {detail ? (
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
            /* ui-copy-ok: rule */ hint="Only the ones still offered on this stage"
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
    </div>
  );
}

function Rules({
  form,
  config,
  sat,
}: Readonly<{ form: TestForm; config: BaseConfigDetail | null; sat: boolean }>) {
  const scope = useWatch({ control: form.control, name: 'scope' });
  const evaluationMode = useWatch({ control: form.control, name: 'evaluationMode' });
  const paperBinding = useWatch({ control: form.control, name: 'paperBinding' });
  const drawStrategy = useWatch({ control: form.control, name: 'drawStrategy' });

  /** Ranked leaves only the frozen paper, so choosing it moves the binding rather than failing. */
  const pickEvaluationMode = (value: string) => {
    const mode = value as EvaluationMode;
    form.setValue('evaluationMode', mode);
    if (!allowedPaperBindings(mode).includes(paperBinding)) {
      form.setValue('paperBinding', PAPER_BINDING.FIXED);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField form={form} name="scope" label="Covers">
        {(control) => (
          <Combobox
            id={control.id}
            value={scope}
            clearable={false}
            disabled={sat}
            onChange={(value) => form.setValue('scope', value as TestScope)}
            items={TEST_SCOPES.map((value) => ({ value, label: TEST_SCOPE_LABELS[value] }))}
          />
        )}
      </FormField>

      <ScopeReference form={form} scope={scope} config={config} disabled={sat} />

      <FormField form={form} name="evaluationMode" label="Evaluation">
        {(control) => (
          <Combobox
            id={control.id}
            value={evaluationMode}
            clearable={false}
            disabled={sat}
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
            onChange={(value) => form.setValue('paperBinding', value as PaperBinding)}
            items={allowedPaperBindings(evaluationMode).map((value) => ({
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
          /* ui-copy-ok: limit */ hint={`How many to draw, up to ${MAX_PAPER_VARIANTS}`}
        >
          {(control) => <Input {...control} disabled={sat} inputMode="numeric" />}
        </FormField>
      ) : null}

      <FormField form={form} name="drawStrategy" label="Draw">
        {(control) => (
          <Combobox
            id={control.id}
            value={drawStrategy}
            clearable={false}
            disabled={sat}
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

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="flex h-9 items-center text-sm text-muted-foreground">{value}</span>
    </div>
  );
}
