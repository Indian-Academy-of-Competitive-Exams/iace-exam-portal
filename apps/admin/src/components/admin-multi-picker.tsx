import { usePagedPicker } from '@iace/app-kit';
import { MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { adminFilterQueryKey } from '../lib/query-keys';
import { itemsOf, namesOf, type MultiPickerProps } from './picker-props';

/** A FILTER over admins, named with the email beside it where there is a name to lead with. */
export function AdminMultiPicker(props: Readonly<MultiPickerProps>) {
  const admins = usePagedPicker({
    queryKey: adminFilterQueryKey(),
    fetchPage: (params) => api.admin.admins.list(params),
    chosen: props.value,
  });

  const { items, chosen } = itemsOf(admins, (admin) => ({
    value: admin.id,
    label: admin.fullName ?? admin.email,
    hint: admin.fullName ? admin.email : undefined,
  }));

  return (
    <MultiCombobox
      {...props}
      selectedLabels={{ ...namesOf(chosen), ...props.selectedLabels }}
      {...admins.paging}
      chips={false}
      items={items}
      searchPlaceholder="Search admins"
      emptyLabel="No admin matches that"
    />
  );
}
