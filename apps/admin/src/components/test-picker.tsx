import { usePagedPicker } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { api } from '../lib/api';
import { testPickerQueryKey } from '../lib/constants';
import { type PickerProps } from './picker-props';

/** Any test, whatever its state: a report is asked for long after the hall has emptied. */
export function TestPicker(props: Readonly<PickerProps>) {
  const tests = usePagedPicker({
    queryKey: testPickerQueryKey(),
    fetchPage: (params) => api.admin.tests.list(params),
  });

  return (
    <Combobox
      {...props}
      {...tests.paging}
      placeholder={props.placeholder ?? 'Choose a test'}
      items={tests.items.map((test) => ({
        value: test.id,
        label: test.title ?? 'Untitled test',
      }))}
      searchPlaceholder="Search tests"
      emptyLabel="No test matches that"
    />
  );
}
