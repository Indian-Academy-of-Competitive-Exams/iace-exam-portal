import { usePagedPicker } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import {
  examFilterQueryKey,
  examPickerQueryKey,
  examStageFilterQueryKey,
  examStagePickerQueryKey,
} from '../lib/constants';
import { type MultiPickerProps, type PickerProps } from './picker-props';

// Exam code is the label — it's what an enrolment stores, so a stage is qualified by it since "Tier 1" alone names several papers.

/** A CHOOSER: only active exams, because a retired one is not something to file new work under. */
export function ExamPicker(props: Readonly<PickerProps>) {
  const exams = usePagedPicker({
    queryKey: examPickerQueryKey(),
    fetchPage: (params) => api.admin.exams.list({ ...params, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      {...exams.paging}
      placeholder={props.placeholder ?? 'All exams'}
      items={exams.items.map((exam) => ({ value: exam.id, label: exam.code, hint: exam.name }))}
      searchPlaceholder="Search exams"
      emptyLabel="No exam matches that"
    />
  );
}

/** What a chosen stage is called, for a caller that has to name something after it. */
export interface StageChoice {
  examCode: string;
  stageName: string;
}

/** Only active stages: a retired one takes no new config, and the save would be refused. */
export function ExamStagePicker({
  examId,
  onChange,
  onPick,
  ...props
}: Readonly<PickerProps & { examId?: string; onPick?: (chosen: StageChoice | null) => void }>) {
  const stages = usePagedPicker({
    queryKey: examStagePickerQueryKey(examId ?? ''),
    fetchPage: (params) =>
      api.admin.examStages.list({ ...params, examId: examId || undefined, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      {...stages.paging}
      placeholder={props.placeholder ?? 'All stages'}
      items={stages.items.map((stage) => ({
        value: stage.id,
        label: `${stage.exam.code} / ${stage.name}`,
        hint: stage.stageKey,
      }))}
      onChange={(value) => {
        const stage = stages.items.find((candidate) => candidate.id === value);
        onPick?.(stage ? { examCode: stage.exam.code, stageName: stage.name } : null);
        onChange(value);
      }}
      searchPlaceholder="Search stages"
      emptyLabel="No stage matches that"
    />
  );
}

/** A FILTER, so it reaches retired exams — tests and configurations are still filed under them. */
export function ExamMultiPicker(props: Readonly<MultiPickerProps>) {
  const exams = usePagedPicker({
    queryKey: examFilterQueryKey(),
    fetchPage: (params) => api.admin.exams.list(params),
  });

  return (
    <MultiCombobox
      {...props}
      {...exams.paging}
      chips={false}
      placeholder={props.placeholder ?? 'All exams'}
      items={exams.items.map((exam) => ({ value: exam.id, label: exam.code, hint: exam.name }))}
      searchPlaceholder="Search exams"
      emptyLabel="No exam matches that"
    />
  );
}

/** A FILTER, so it reaches retired stages too, for the same reason as the exams beside it. */
export function ExamStageMultiPicker({
  examIds,
  ...props
}: Readonly<MultiPickerProps & { examIds: readonly string[] }>) {
  const stages = usePagedPicker({
    queryKey: examStageFilterQueryKey([...examIds].join(',')),
    fetchPage: (params) => api.admin.examStages.list({ ...params, examId: [...examIds] }),
  });

  return (
    <MultiCombobox
      {...props}
      {...stages.paging}
      chips={false}
      placeholder={props.placeholder ?? 'All stages'}
      items={stages.items.map((stage) => ({
        value: stage.id,
        label: `${stage.exam.code} / ${stage.name}`,
        hint: stage.stageKey,
      }))}
      searchPlaceholder="Search stages"
      emptyLabel="No stage matches that"
    />
  );
}
