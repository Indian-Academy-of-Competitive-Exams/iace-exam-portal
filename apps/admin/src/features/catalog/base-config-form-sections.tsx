import type { Dispatch, SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { UseFieldArrayReturn, UseFormReturn } from 'react-hook-form';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  EXAM_TEMPLATES,
  LANGUAGE_MODES,
  NAVIGATION_POLICIES,
  TEST_UIS,
  TIMER_TEMPLATE,
  TIMER_TEMPLATES,
  type BaseConfigDetail,
} from '@iace/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  FieldRow,
  FormCombobox,
  FormField,
  FormSection,
  Input,
  plural,
  ReadOnlyField,
} from '@iace/ui';
import {
  EXAM_TEMPLATE_HINTS,
  EXAM_TEMPLATE_LABELS,
  LANGUAGE_MODE_HINTS,
  LANGUAGE_MODE_LABELS,
  NAVIGATION_POLICY_HINTS,
  NAVIGATION_POLICY_LABELS,
  TEST_UI_LABELS,
  TIMER_TEMPLATE_HINTS,
  TIMER_TEMPLATE_LABELS,
} from '../../lib/labels';
import { api } from '../../lib/api';
import { ROUTES } from '../../lib/constants';
import { ExamStagePicker } from '../../components/exam-picker';
import { type ConfigFormValues, emptySection, NUMBER_FIELD } from './base-config-values';
import { ToggleField, LanguageChoice, SectionCard } from './base-config-fields';

type ConfigForm = UseFormReturn<ConfigFormValues>;

/** Locked is the one state with no way into the form, so it offers the clone instead. */
export function HeaderAction({
  isEditing,
  locked,
  onClone,
  onEdit,
}: Readonly<{ isEditing: boolean; locked: boolean; onClone: () => void; onEdit: () => void }>) {
  if (isEditing) return null;
  if (locked) {
    return (
      <Button size="sm" onClick={onClone}>
        <Copy aria-hidden />
        Clone to change it
      </Button>
    );
  }
  return (
    <Button size="sm" onClick={onEdit}>
      <Pencil aria-hidden />
      Edit
    </Button>
  );
}

/** What stands between an admin and this form: somebody else in it, or a paper already sat. */
export function EditorBanners({
  elsewhere,
  locked,
}: Readonly<{ elsewhere: { fullName: string | null } | null; locked: boolean }>) {
  return (
    <>
      {elsewhere ? (
        <Alert variant="warning">
          {elsewhere.fullName ?? 'Another admin'} is editing this configuration. Their changes have
          to land first.
        </Alert>
      ) : null}

      {locked ? (
        <Alert variant="warning">
          <span>
            This configuration is locked. A test built from it has already been sat, and a paper
            somebody has sat cannot change shape underneath them. Every field below is fixed for
            good. Clone it to carry all of this into a copy you can edit: the copy starts unlocked
            and is not the stage&apos;s default until you promote it. The name, and whether this one
            is still offered, can be changed from the configurations list.
          </span>
        </Alert>
      ) : null}
    </>
  );
}

export function StageSection({
  form,
  detail,
  examStageId,
}: Readonly<{ form: ConfigForm; detail: BaseConfigDetail | null; examStageId: string }>) {
  return (
    <FormSection title="Stage">
      <FieldRow>
        {detail ? (
          <ReadOnlyField
            label="Stage"
            value={`${detail.examStage.exam.code} / ${detail.examStage.name}`}
          />
        ) : (
          <FormField form={form} name="examStageId" label="Stage">
            {(control) => (
              <ExamStagePicker
                id={control.id}
                value={examStageId}
                placeholder="Choose a stage"
                onChange={(value) => form.setValue('examStageId', value, { shouldValidate: true })}
              />
            )}
          </FormField>
        )}

        <FormField form={form} name="name" label="Name">
          {(control) => <Input {...control} placeholder="SSC CGL Tier 1, 2024 pattern" />}
        </FormField>

        <ToggleField form={form} name="isDefault" label="The stage's default pattern" />

        {detail ? (
          <ToggleField
            form={form}
            name="isActive"
            label="Offered when building a test"
            /* ui-copy-ok: rule */ hint="Tests already built keep it"
          />
        ) : null}
      </FieldRow>
    </FormSection>
  );
}

export function PaperSection({
  form,
  omrNeedsDefault,
}: Readonly<{ form: ConfigForm; omrNeedsDefault: boolean }>) {
  return (
    <FormSection title="How the paper runs">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField form={form} name="durationMin" label="Duration (minutes)">
          {(control) => (
            <Input
              {...control}
              {...form.register('durationMin', NUMBER_FIELD)}
              inputMode="decimal"
              placeholder="60"
            />
          )}
        </FormField>

        <FormCombobox
          form={form}
          name="timerTemplate"
          label="Timing pattern"
          items={TIMER_TEMPLATES.map((value) => ({
            value,
            label: TIMER_TEMPLATE_LABELS[value],
            hint: TIMER_TEMPLATE_HINTS[value],
          }))}
        />

        <FormCombobox
          form={form}
          name="navigation"
          label="Navigation"
          items={NAVIGATION_POLICIES.map((value) => ({
            value,
            label: NAVIGATION_POLICY_LABELS[value],
            hint: NAVIGATION_POLICY_HINTS[value],
          }))}
        />

        <FormCombobox
          form={form}
          name="defaultTestUi"
          label="Test interface"
          items={TEST_UIS.map((value) => ({ value, label: TEST_UI_LABELS[value] }))}
        />

        {omrNeedsDefault ? (
          <Alert variant="warning">
            An OMR sheet is only drawn by the default template. Set the template to Default, or
            answer on screen.
          </Alert>
        ) : null}

        <FormCombobox
          form={form}
          name="languageMode"
          label="Language mode"
          items={LANGUAGE_MODES.map((value) => ({
            value,
            label: LANGUAGE_MODE_LABELS[value],
            hint: LANGUAGE_MODE_HINTS[value],
          }))}
        />

        <FormCombobox
          form={form}
          name="examTemplate"
          label="Exam template"
          items={EXAM_TEMPLATES.map((value) => ({
            value,
            label: EXAM_TEMPLATE_LABELS[value],
            hint: EXAM_TEMPLATE_HINTS[value],
          }))}
        />

        <FormField
          form={form}
          name="optionalSectionCount"
          label="Optional sections"
          /* ui-copy-ok: rule */ hint="Blank means none"
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('optionalSectionCount', NUMBER_FIELD)}
              inputMode="numeric"
              placeholder="0"
            />
          )}
        </FormField>

        <div className="sm:col-span-2 lg:col-span-3">
          <LanguageChoice form={form} />
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-2 sm:col-span-2 lg:col-span-3">
          <ToggleField form={form} name="shuffleQuestions" label="Shuffle the questions" />
          <ToggleField form={form} name="shuffleOptions" label="Shuffle the options" />
          <ToggleField form={form} name="calculatorEnabled" label="Offer a calculator" />
        </div>
      </div>
    </FormSection>
  );
}

export function SessionsSection({
  form,
  modules,
  displaced,
  onRemove,
}: Readonly<{
  form: ConfigForm;
  modules: UseFieldArrayReturn<ConfigFormValues, 'modules'>;
  displaced: string | null;
  onRemove: (index: number) => void;
}>) {
  return (
    <FormSection title="Sessions">
      <div className="flex flex-col gap-3">
        {modules.fields.map((field, index) => (
          <div
            key={field.id}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
          >
            <FormField
              form={form}
              name={`modules.${index}.name`}
              label="Session"
              className="min-w-48 flex-1"
            >
              {(control) => <Input {...control} placeholder="Session 1" />}
            </FormField>
            <FormField
              form={form}
              name={`modules.${index}.durationMin`}
              label="Minutes"
              className="w-28"
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`modules.${index}.durationMin`, NUMBER_FIELD)}
                  inputMode="decimal"
                />
              )}
            </FormField>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove session ${index + 1}`}
              onClick={() => onRemove(index)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}

        {displaced ? <Alert variant="warning">{displaced}</Alert> : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => modules.append({ name: '', durationMin: '' })}
          >
            <Plus aria-hidden />
            Add a session
          </Button>
        </div>
      </div>
    </FormSection>
  );
}

export function SectionsSection({
  form,
  sections,
  issues,
  timerTemplate,
  sessionPaper,
}: Readonly<{
  form: ConfigForm;
  sections: UseFieldArrayReturn<ConfigFormValues, 'sections'>;
  issues: readonly string[];
  timerTemplate: ConfigFormValues['timerTemplate'];
  sessionPaper: boolean;
}>) {
  return (
    <FormSection title="Sections">
      <div className="flex flex-col gap-4">
        {issues.length > 0 ? (
          <Alert variant="danger">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {sections.fields.map((field, index) => (
          <SectionCard
            key={field.id}
            form={form}
            index={index}
            sectionalClocks={timerTemplate === TIMER_TEMPLATE.SECTIONAL_LOCKED}
            perQuestionClocks={timerTemplate === TIMER_TEMPLATE.PER_ITEM_TIMED}
            sessionPaper={sessionPaper}
            canRemove={sections.fields.length > 1}
            onRemove={() => sections.remove(index)}
          />
        ))}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sections.append(emptySection())}
          >
            <Plus aria-hidden />
            Add a section
          </Button>
        </div>
      </div>
    </FormSection>
  );
}

export function EditorDialogs({
  detail,
  asking,
  onAskingChange,
  promoting,
  onPromotingClose,
  saving,
  losingDefault,
  onPromote,
}: Readonly<{
  detail: BaseConfigDetail | null;
  asking: boolean;
  onAskingChange: Dispatch<SetStateAction<boolean>>;
  promoting: boolean;
  onPromotingClose: () => void;
  saving: boolean;
  losingDefault: string | null;
  onPromote: () => void;
}>) {
  const navigate = useNavigate();
  const clone = useMutation({
    meta: { success: 'Configuration cloned.' },
    mutationFn: () => api.admin.baseConfigs.clone(detail?.id ?? '', {}),
    onSuccess: (copy: BaseConfigDetail) => {
      onAskingChange(false);
      navigate(ROUTES.BASE_CONFIG(copy.id));
    },
    onError: () => onAskingChange(false),
  });

  return (
    <>
      {detail ? (
        <ConfirmDialog
          open={asking}
          onOpenChange={onAskingChange}
          loading={clone.isPending}
          title={`Clone ${detail.name}?`}
          description={`The copy carries every setting and all ${plural(detail.totalQuestions, 'question')} of its sections as they stand now. It starts unlocked, is not the stage's default, and ${detail.name} is left exactly as it is. You will land on the copy.`}
          confirmLabel="Clone configuration"
          onConfirm={() => clone.mutate()}
        />
      ) : null}

      <ConfirmDialog
        open={promoting}
        onOpenChange={(open) => !open && onPromotingClose()}
        loading={saving}
        title="The stage's default pattern"
        // ui-copy-ok: consequence — a confirm names what it is about to take away
        description={`${losingDefault ?? 'The current default'} is the stage's default now and stops being it. Tests already built keep the configuration they were created from; only new ones start from this.`}
        confirmLabel="Make it the default"
        onConfirm={onPromote}
      />
    </>
  );
}
