import { useWatch, type UseFormReturn } from 'react-hook-form';
import { TEST_SERIES_KIND, type TestSeriesKind, type TestSeriesSummary } from '@iace/contracts';
import { FieldRow, FormCombobox, FormField, FormSection } from '@iace/ui';
import { ExamStagePicker, type StageChoice } from '../../components/exam-picker';
import { EventPicker, ProgramPicker } from '../../components/access-picker';
import { KIND_ITEMS, chooseKind, type SeriesFormValues } from './test-series-detail';

/** The one target its kind requires, which is why exactly one of these is ever on screen. */
function KindTarget({
  form,
  detail,
  kind,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  detail: TestSeriesSummary | null;
  kind: TestSeriesKind;
}>) {
  const programCode = useWatch({ control: form.control, name: 'programCode' });
  const eventId = useWatch({ control: form.control, name: 'eventId' });

  if (kind === TEST_SERIES_KIND.PROGRAM) {
    return (
      <FormField form={form} name="programCode" label="Program">
        {(control) => (
          <ProgramPicker
            id={control.id}
            value={programCode}
            clearable={false}
            placeholder="Choose a program"
            selectedLabel={detail?.programCode ?? undefined}
            onChange={(value) => form.setValue('programCode', value, { shouldDirty: true })}
          />
        )}
      </FormField>
    );
  }

  if (kind === TEST_SERIES_KIND.EVENT) {
    return (
      <FormField form={form} name="eventId" label="Event">
        {(control) => (
          <EventPicker
            id={control.id}
            value={eventId}
            clearable={false}
            placeholder="Choose an event"
            selectedLabel={detail?.eventName ?? undefined}
            onChange={(value) => form.setValue('eventId', value, { shouldDirty: true })}
          />
        )}
      </FormField>
    );
  }

  return null;
}

/** Who the series is for. Every field follows the kind, so no admin can assemble a refused save. */
export function SeriesAccess({
  form,
  detail,
  onPickStage,
}: Readonly<{
  form: UseFormReturn<SeriesFormValues>;
  detail: TestSeriesSummary | null;
  onPickStage: (chosen: StageChoice | null) => void;
}>) {
  const kind = useWatch({ control: form.control, name: 'kind' });
  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const spansACourse = kind === TEST_SERIES_KIND.FREE;

  return (
    <FormSection title="Access">
      <FieldRow>
        <FormCombobox
          form={form}
          name="kind"
          label="Kind"
          items={KIND_ITEMS}
          onChange={(next) => chooseKind(form, next as TestSeriesKind)}
        />

        <FormField
          form={form}
          name="examStageId"
          label="Stage"
          /* ui-copy-ok: rule */ hint={
            spansACourse ? 'Optional' : 'Only a free series goes without one'
          }
        >
          {(control) => (
            <ExamStagePicker
              id={control.id}
              value={examStageId}
              clearable={spansACourse}
              selectedLabel={
                detail?.examStage
                  ? `${detail.examStage.examCode} / ${detail.examStage.name}`
                  : undefined
              }
              placeholder={spansACourse ? 'Any stage' : 'Choose a stage'}
              onPick={onPickStage}
              onChange={(value) => form.setValue('examStageId', value, { shouldDirty: true })}
            />
          )}
        </FormField>

        <KindTarget form={form} detail={detail} kind={kind} />
      </FieldRow>
    </FormSection>
  );
}
