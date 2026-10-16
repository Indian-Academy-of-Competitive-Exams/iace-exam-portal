/// <reference types="nativewind/types" />
import { View } from 'react-native';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Text } from './text';
import { Picker, type PickerItem } from './picker';

export interface FormPickerProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: Path<TValues>;
  label: string;
  items: readonly PickerItem[];
  placeholder: string;
  /** Called after the field takes the new value, for a choice that clears another. */
  onPicked?: (next: string) => void;
}

/** A `Picker` bound to one react-hook-form field, its error below it like `TextField`'s. */
export function FormPicker<TValues extends FieldValues>({
  control,
  name,
  onPicked,
  ...picker
}: Readonly<FormPickerProps<TValues>>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View className="gap-1.5">
          <Picker
            {...picker}
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={(next) => {
              field.onChange(next);
              onPicked?.(next);
            }}
          />
          {fieldState.error?.message ? (
            <Text className="text-sm text-destructive">{fieldState.error.message}</Text>
          ) : null}
        </View>
      )}
    />
  );
}
