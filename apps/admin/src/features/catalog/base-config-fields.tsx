import { useEffect, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import {
  LANGUAGE_CODES,
  MERIT_TYPE,
  MERIT_TYPES,
  configTotalsOf,
  type LanguageCode,
  TYPING_PRESETS,
  TYPING_PRESET_KEYS,
  typingPresetKeySchema,
} from '@iace/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Combobox,
  FormCombobox,
  FormField,
  FormSection,
  Input,
  StatRow,
} from '@iace/ui';
import { LANGUAGE_CODE_LABELS, MERIT_TYPE_HINTS, MERIT_TYPE_LABELS } from '../../lib/labels';
import { minutesFieldOf } from '../../lib/duration';
import { SubjectPicker } from '../../components/taxonomy-picker';
import { useSubjectLanguage } from '../authoring/subject-languages';
import { type ConfigFormValues, toSectionDraft, NUMBER_FIELD } from './base-config-values';

/** A boolean the form owns. Controlled, because `register` alone cannot hold a checkbox's state. */
export function ToggleField({
  form,
  name,
  label,
  hint,
}: Readonly<{
  form: UseFormReturn<ConfigFormValues>;
  name: 'isDefault' | 'isActive' | 'shuffleQuestions' | 'shuffleOptions' | 'calculatorEnabled';
  label: string;
  hint?: string;
}>) {
  const checked = useWatch({ control: form.control, name });

  return (
    <Checkbox
      checked={checked}
      onChange={(event) => form.setValue(name, event.target.checked)}
      label={label}
      /* ui-copy-ok: rule */ hint={hint}
    />
  );
}

/** Which languages the paper is offered in. Three fixed codes, so checkboxes rather than a list. */
export function LanguageChoice({ form }: Readonly<{ form: UseFormReturn<ConfigFormValues> }>) {
  const languages = useWatch({ control: form.control, name: 'languages' }) ?? [];
  const error = form.formState.errors.languages?.message;

  const toggle = (code: LanguageCode) => {
    // Never registered, so nothing re-validates it: an error left here would block every later save.
    form.clearErrors('languages');
    form.setValue(
      'languages',
      languages.includes(code) ? languages.filter((kept) => kept !== code) : [...languages, code],
    );
  };

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-foreground">Languages</legend>
      <div className="flex flex-wrap gap-1">
        {LANGUAGE_CODES.map((code) => (
          <Checkbox
            key={code}
            checked={languages.includes(code)}
            onChange={() => toggle(code)}
            label={LANGUAGE_CODE_LABELS[code]}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The first row is the ordinary case, so a section is a typing test only when one is chosen. */
const TYPING_TEST_ITEMS = [
  { value: '', label: 'Not a typing test' },
  ...TYPING_PRESET_KEYS.map((key) => ({ value: key, label: TYPING_PRESETS[key].label })),
];

export function SectionCard({
  form,
  index,
  sectionalClocks,
  perQuestionClocks,
  sessionPaper,
  canRemove,
  onRemove,
}: Readonly<{
  form: UseFormReturn<ConfigFormValues>;
  index: number;
  sectionalClocks: boolean;
  perQuestionClocks: boolean;
  sessionPaper: boolean;
  canRemove: boolean;
  onRemove: () => void;
}>) {
  const subjectId = useWatch({ control: form.control, name: `sections.${index}.subjectId` });
  const merit = useWatch({ control: form.control, name: `sections.${index}.meritOrQualifying` });
  const mandatory = useWatch({ control: form.control, name: `sections.${index}.mandatory` });
  const modules = useWatch({ control: form.control, name: 'modules' }) ?? [];
  const moduleNames = sessionPaper ? modules.map((module) => module.name) : [];
  const typingPreset = useWatch({ control: form.control, name: `sections.${index}.typingPreset` });
  const isTyping = typingPreset !== '';
  const descriptive = useWatch({ control: form.control, name: `sections.${index}.descriptive` });
  const [clearedDescriptive, setClearedDescriptive] = useState(false);
  const paperLanguages = useWatch({ control: form.control, name: 'languages' }) ?? [];
  const language = useWatch({ control: form.control, name: `sections.${index}.language` });
  const tested = useSubjectLanguage(subjectId || undefined);
  const testedCode = tested ? (tested.toUpperCase() as LanguageCode) : '';
  // A section of a language subject is sat in that language alone, so choosing the subject sets it.
  useEffect(() => {
    if (testedCode && language !== testedCode) {
      form.setValue(`sections.${index}.language`, testedCode, { shouldDirty: true });
    }
  }, [form, index, language, testedCode]);

  // A typing test is one unmarked passage on its standard's clock, so choosing one fills all four.
  const chooseTyping = (key: string) => {
    form.setValue(`sections.${index}.typingPreset`, key, { shouldDirty: true });
    const preset = typingPresetKeySchema.safeParse(key).data;
    if (!preset) {
      setClearedDescriptive(false);
      return;
    }
    // The tick a typing test hides must not stay set where no one can untick it.
    if (descriptive) {
      form.setValue(`sections.${index}.descriptive`, false, { shouldDirty: true });
      setClearedDescriptive(true);
    }
    form.setValue(`sections.${index}.questionCount`, '1');
    form.setValue(`sections.${index}.marksPerQuestion`, '0');
    form.setValue(`sections.${index}.negativeMarks`, '0');
    form.setValue(`sections.${index}.perQuestionSec`, '');
    form.setValue(
      `sections.${index}.durationMin`,
      minutesFieldOf(TYPING_PRESETS[preset].durationSec),
    );
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Section {index + 1}</span>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove section ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField form={form} name={`sections.${index}.name`} label="Name">
          {(control) => <Input {...control} placeholder="General Intelligence" />}
        </FormField>

        <FormField
          form={form}
          name={`sections.${index}.subjectId`}
          label="Subject"
          /* ui-copy-ok: rule */ hint="Optional"
        >
          {(control) => (
            <SubjectPicker
              id={control.id}
              value={subjectId}
              clearable
              placeholder="Any subject"
              onChange={(value) => form.setValue(`sections.${index}.subjectId`, value)}
            />
          )}
        </FormField>

        <FormField form={form} name={`sections.${index}.typingPreset`} label="Typing test">
          {(control) => (
            <Combobox
              id={control.id}
              value={typingPreset}
              clearable={false}
              items={TYPING_TEST_ITEMS}
              onChange={chooseTyping}
            />
          )}
        </FormField>

        {isTyping ? null : (
          <>
            <FormField form={form} name={`sections.${index}.questionCount`} label="Questions">
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`sections.${index}.questionCount`, NUMBER_FIELD)}
                  inputMode="numeric"
                  placeholder="25"
                />
              )}
            </FormField>

            <FormField
              form={form}
              name={`sections.${index}.marksPerQuestion`}
              label="Marks per question"
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`sections.${index}.marksPerQuestion`, NUMBER_FIELD)}
                  inputMode="decimal"
                  placeholder="2"
                />
              )}
            </FormField>

            <FormField
              form={form}
              name={`sections.${index}.negativeMarks`}
              label="Negative marks"
              /* ui-copy-ok: unit */ hint="Per wrong answer"
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`sections.${index}.negativeMarks`, NUMBER_FIELD)}
                  inputMode="decimal"
                  placeholder="0.5"
                />
              )}
            </FormField>
          </>
        )}

        <FormField
          form={form}
          name={`sections.${index}.durationMin`}
          label="Minutes"
          /* ui-copy-ok: rule */ hint={
            sectionalClocks ? 'Required: this paper has a clock per section' : 'Optional'
          }
        >
          {(control) => (
            <Input
              {...control}
              {...form.register(`sections.${index}.durationMin`, NUMBER_FIELD)}
              inputMode="decimal"
            />
          )}
        </FormField>

        {isTyping ? null : (
          <FormField
            form={form}
            name={`sections.${index}.perQuestionSec`}
            label="Seconds per question"
            /* ui-copy-ok: rule */ hint={
              perQuestionClocks ? 'Required: this paper has a countdown per question' : 'Optional'
            }
          >
            {(control) => (
              <Input
                {...control}
                {...form.register(`sections.${index}.perQuestionSec`, NUMBER_FIELD)}
                inputMode="numeric"
              />
            )}
          </FormField>
        )}

        <FormField
          form={form}
          name={`sections.${index}.patternNote`}
          label="Pattern note"
          /* ui-copy-ok: rule */ hint="Reference only; nothing draws on it"
        >
          {(control) => <Input {...control} placeholder="Moderate-Difficult" />}
        </FormField>

        <FormCombobox
          form={form}
          name={`sections.${index}.meritOrQualifying`}
          label="Merit or qualifying"
          items={MERIT_TYPES.map((value) => ({
            value,
            label: MERIT_TYPE_LABELS[value],
            hint: MERIT_TYPE_HINTS[value],
          }))}
        />

        {merit === MERIT_TYPE.QUALIFYING ? (
          <FormField
            form={form}
            name={`sections.${index}.qualifyingCutoff`}
            label="Qualifying cutoff"
          >
            {(control) => (
              <Input
                {...control}
                {...form.register(`sections.${index}.qualifyingCutoff`, NUMBER_FIELD)}
                inputMode="decimal"
              />
            )}
          </FormField>
        ) : null}

        {paperLanguages.length > 1 ? (
          <FormCombobox
            form={form}
            name={`sections.${index}.language`}
            label="Language"
            /* ui-copy-ok: rule */ hint="English Language is sat in English, whatever a student picks"
            items={[
              { value: '', label: "The paper's languages" },
              ...paperLanguages.map((code) => ({
                value: code,
                label: `${LANGUAGE_CODE_LABELS[code]} only`,
              })),
            ]}
          />
        ) : null}

        {moduleNames.length > 0 ? (
          <FormCombobox
            form={form}
            name={`sections.${index}.moduleOrder`}
            label="Session"
            items={[
              { value: '', label: 'The first session' },
              ...moduleNames.map((name, moduleIndex) => ({
                value: String(moduleIndex),
                label: name || `Session ${moduleIndex + 1}`,
              })),
            ]}
          />
        ) : null}
      </div>

      {isTyping && clearedDescriptive ? (
        <Alert variant="warning">
          Descriptive is cleared: a typing test has no written answers.
        </Alert>
      ) : null}
      {isTyping ? null : (
        <Checkbox
          checked={descriptive}
          // A written answer is never charged for, so the negative goes as the section becomes one.
          onChange={(event) => {
            form.setValue(`sections.${index}.descriptive`, event.target.checked, {
              shouldDirty: true,
            });
            if (event.target.checked) form.setValue(`sections.${index}.negativeMarks`, '0');
          }}
          label="Descriptive: essays, letters and précis"
        />
      )}
      <Checkbox
        checked={mandatory}
        onChange={(event) => form.setValue(`sections.${index}.mandatory`, event.target.checked)}
        label="Every student must attempt this section"
      />
    </div>
  );
}

/** The cache the server keeps on the config, summed live so it is never typed. */
export function Totals({ form }: Readonly<{ form: UseFormReturn<ConfigFormValues> }>) {
  const sections = useWatch({ control: form.control, name: 'sections' }) ?? [];
  const totals = configTotalsOf(sections.map((section, index) => toSectionDraft(section, index)));

  return (
    <FormSection title="Totals">
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
        <StatRow label="Sections" value={sections.length} />
        <StatRow label="Questions" value={totals.totalQuestions} />
        <StatRow label="Marks" value={totals.totalMarks} />
      </div>
    </FormSection>
  );
}
