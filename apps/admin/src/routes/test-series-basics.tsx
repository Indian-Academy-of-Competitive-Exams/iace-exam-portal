import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Checkbox, FieldRow, FormField, FormSection, Input } from '@iace/ui';
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
  const inOrder = useWatch({ control: form.control, name: 'sequentialTests' });

  const suggested = useSuggestedSeriesName({
    examCode: stage?.examCode,
    stageName: stage?.stageName,
    examStageId: examStageId || undefined,
    programCode,
    kind,
  });

  return (
    <FormSection title="Details">
      <FieldRow>
        <FormField form={form} name="name" label="Name">
          {(control) => (
            <Input
              {...control}
              placeholder="SSC CGL Tier 1 Mock Test Series"
              suggestion={name?.trim() === '' ? suggested : undefined}
              onAcceptSuggestion={(next) =>
                form.setValue('name', next, { shouldDirty: true, shouldValidate: true })
              }
            />
          )}
        </FormField>

        <div className="sm:col-span-2">
          {/* Controlled, because `register` alone cannot hold a checkbox's state. */}
          <Checkbox
            checked={inOrder}
            onChange={(event) =>
              form.setValue('sequentialTests', event.target.checked, { shouldDirty: true })
            }
            label="Open the tests in order"
            /* ui-copy-ok: rule */
            hint="Each test opens after the one before it; off opens them all together."
          />
        </div>
      </FieldRow>
    </FormSection>
  );
}

// ============================================================================
// Where it runs. Every branch already has a row — this only ever flips one.
// ============================================================================
