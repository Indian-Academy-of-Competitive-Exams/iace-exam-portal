import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Checkbox, FormField, FormSection, Input, Textarea } from '@iace/ui';
import { useSuggestedSeriesName } from '../lib/use-suggested-name';
import { type SeriesFormValues } from './test-series-detail';
import { type StageChoice } from '../components/exam-picker';

/** What the series is called, and the two rules it opens its tests under. */

export function SeriesBasics({
  form,
  stage,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  stage: StageChoice | null;
}>) {
  const name = useWatch({ control: form.control, name: 'name' });
  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const programCode = useWatch({ control: form.control, name: 'programCode' });
  const kind = useWatch({ control: form.control, name: 'kind' });

  const suggested = useSuggestedSeriesName({
    examCode: stage?.examCode,
    stageName: stage?.stageName,
    examStageId: examStageId || undefined,
    programCode,
    kind,
  });

  return (
    <FormSection title="Details">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField form={form} name="name" label="Name">
          {(control) => (
            <Input
              {...control}
              placeholder="SSC CGL Tier 1 — Mock Test Series"
              suggestion={name?.trim() === '' ? suggested : undefined}
              onAcceptSuggestion={(next) =>
                form.setValue('name', next, { shouldDirty: true, shouldValidate: true })
              }
            />
          )}
        </FormField>

        <FormField
          form={form}
          name="description"
          label="Description"
          /* ui-copy-ok: rule */ hint="Optional"
        >
          {(control) => <Textarea {...control} />}
        </FormField>

        <div className="flex flex-col gap-3 sm:col-span-2">
          <SeriesToggle
            form={form}
            name="sequentialTests"
            label="Open the tests in order"
            /* ui-copy-ok: rule */ hint="Off opens every test in the series together."
          />
          <SeriesToggle
            form={form}
            name="progressive"
            label="Progressive"
            /* ui-copy-ok: rule */ hint="Each paper harder than the last; students see the climb against the ramp."
          />
        </div>
      </div>
    </FormSection>
  );
}

/** A boolean the form owns. Controlled, because `register` alone cannot hold a checkbox's state. */
function SeriesToggle({
  form,
  name,
  label,
  hint,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  name: 'sequentialTests' | 'progressive';
  label: string;
  hint?: string;
}>) {
  const checked = useWatch({ control: form.control, name });

  return (
    <Checkbox
      checked={checked}
      onChange={(event) => form.setValue(name, event.target.checked, { shouldDirty: true })}
      label={label}
      /* ui-copy-ok: rule */ hint={hint}
    />
  );
}

// ============================================================================
// Where it runs. Every branch already has a row — this only ever flips one.
// ============================================================================
