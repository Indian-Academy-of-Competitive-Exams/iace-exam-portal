import { usePagedPicker } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { adminFilterQueryKey, adminPickerQueryKey } from '../lib/query-keys';
import { itemsOf, namesOf, type MultiPickerProps, type PickerProps } from './picker-props';

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

/** A CHOOSER: only active admins, because work handed to a deactivated one is work nobody sees. */
export function AdminPicker(props: Readonly<PickerProps>) {
  const admins = usePagedPicker({
    queryKey: adminPickerQueryKey(),
    fetchPage: (params) => api.admin.admins.list({ ...params, activeOnly: 'true' }),
    chosen: [props.value],
  });

  const { items, chosen } = itemsOf(admins, (admin) => ({
    value: admin.id,
    label: admin.fullName ?? admin.email,
    hint: admin.fullName ? admin.email : undefined,
  }));

  return (
    <Combobox
      {...props}
      selectedLabel={props.selectedLabel ?? namesOf(chosen)[props.value]}
      {...admins.paging}
      items={items}
      searchPlaceholder="Search admins"
      emptyLabel="No admin matches that"
    />
  );
}
