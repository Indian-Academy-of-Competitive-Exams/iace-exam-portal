import { REPORT_PARAMS, type ReportChoiceParam } from '@iace/contracts';
import { usePagedPicker } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { type PickerProps } from '../../components/picker-props';
import { api } from '../../lib/api';
import { reportChoicesQueryKey } from '../../lib/constants';

const PLACEHOLDERS: Readonly<Record<ReportChoiceParam, string>> = {
  [REPORT_PARAMS.TEST]: 'Choose a test',
  [REPORT_PARAMS.STUDENT]: 'Choose a student',
  [REPORT_PARAMS.ATTEMPT]: 'Choose a sitting',
  [REPORT_PARAMS.SERIES]: 'Choose a series',
  [REPORT_PARAMS.EVENT]: 'Choose an event',
  [REPORT_PARAMS.BRANCH]: 'Any branch',
};

/** One picker for whatever a report is asked by, read from the reports' own route and no other feature's. */
export function ReportChoicePicker({
  param,
  studentId,
  ...props
}: Readonly<PickerProps & { param: ReportChoiceParam; studentId?: string }>) {
  // A sitting is somebody's: until a student is chosen there is no list to offer.
  const awaitingStudent = param === REPORT_PARAMS.ATTEMPT && !studentId;

  const choices = usePagedPicker({
    queryKey: reportChoicesQueryKey(param, studentId ?? ''),
    fetchPage: (params) => api.admin.reports.choices(param, { ...params, studentId }),
    enabled: !awaitingStudent,
  });

  return (
    <Combobox
      {...props}
      {...choices.paging}
      disabled={awaitingStudent || props.disabled}
      placeholder={awaitingStudent ? 'Choose a student first' : PLACEHOLDERS[param]}
      items={choices.items.map((choice) => ({
        value: choice.value,
        label: choice.label,
        hint: choice.hint ?? undefined,
      }))}
      searchPlaceholder="Search"
      emptyLabel="Nothing matches that"
    />
  );
}
