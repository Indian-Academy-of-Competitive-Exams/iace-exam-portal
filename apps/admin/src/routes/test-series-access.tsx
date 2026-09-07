import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { TEST_SERIES_KIND, type TestSeriesKind, type TestSeriesSummary } from '@iace/contracts';
import { Checkbox, Combobox, ConfirmDialog, FormField, plural } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';
import { ExamStagePicker, type StageChoice } from '../components/exam-picker';
import { EventPicker, ProgramPicker } from '../components/access-picker';
import { KIND_ITEMS, chooseKind, seriesKey, type SeriesFormValues } from './test-series-detail';

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
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField form={form} name="kind" label="Kind">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={kind}
            onChange={(next) => chooseKind(form, next as TestSeriesKind)}
            items={KIND_ITEMS}
          />
        )}
      </FormField>

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
    </div>
  );
}

/** Turning it on and turning it off are not the same question, so they are not the same words. */
function switchQuestion(
  series: TestSeriesSummary,
  next: boolean,
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
  const tests = plural(series.testCount, 'test');

  if (next) {
    return {
      title: `Switch ${series.name} on?`,
      description: `Everyone its kind reaches can start its ${tests} from now on. Which students that is comes from the kind; this switch decides whether any of them may sit anything at all.`,
      confirmLabel: 'Switch it on',
      destructive: false,
    };
  }

  return {
    title: `Switch ${series.name} off?`,
    description: `It reaches nobody while it is off, and its ${tests} leave every student's list at once. Attempts already made and their results are kept, and a test somebody is sitting right now is not stopped.`,
    confirmLabel: 'Switch it off',
    destructive: true,
  };
}

/** The master switch. It changes who can sit a test, so it asks in both directions. */
export function SeriesSwitch({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<boolean | null>(null);

  const save = useMutation({
    meta: { success: `${series.name} saved.` },
    mutationFn: (isEnabled: boolean) => api.admin.testSeries.update(series.id, { isEnabled }),
    onSuccess: (saved) => {
      setAsking(null);
      queryClient.setQueryData(seriesKey(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
    },
    // Drop out of the confirm on failure, or the row is left asking a question already answered.
    onError: () => setAsking(null),
  });

  const question = switchQuestion(series, asking ?? !series.isEnabled);

  return (
    <>
      <Checkbox
        checked={series.isEnabled}
        disabled={save.isPending}
        onChange={(event) => setAsking(event.target.checked)}
        label="Enabled"
        /* ui-copy-ok: consequence */ hint="Off reaches nobody, whatever the kind"
      />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        destructive={question.destructive}
        loading={save.isPending}
        title={question.title}
        description={question.description}
        confirmLabel={question.confirmLabel}
        onConfirm={() => asking !== null && save.mutate(asking)}
      />
    </>
  );
}
