/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { civilDate } from '@iace/contracts';
import { Text } from './text';
import { cn } from '../../lib/cn';

export interface DateFieldProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: Path<TValues>;
  label: string;
  hint?: string;
  /** Bounded both ends: a picker offering what the server refuses is a dead end. */
  minimum?: string;
  maximum?: string;
}

/** A civil date, picked rather than typed. The value stays the `YYYY-MM-DD` the server takes. */
export function DateField<TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  minimum,
  maximum,
}: Readonly<DateFieldProps<TValues>>) {
  const [open, setOpen] = useState(false);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const held = typeof field.value === 'string' ? field.value : '';
        // The hint gives way to the error rather than stacking, so the height never changes.
        const message = fieldState.error?.message ?? hint;

        const chosen = (_event: DateTimePickerChangeEvent, picked: Date) => {
          // Android's dialog dismisses itself; iOS's spinner stays until the field is tapped again.
          if (Platform.OS !== 'ios') setOpen(false);
          field.onChange(civilDate(picked));
        };

        return (
          <View className="flex flex-col gap-1.5">
            <Text variant="label">{label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => setOpen((shown) => !shown)}
              className={cn(
                'h-11 justify-center rounded-md border border-input bg-surface px-3',
                fieldState.error && 'border-destructive',
              )}
            >
              <Text className={held ? 'text-base text-foreground' : 'text-base text-placeholder'}>
                {held || 'Choose a date'}
              </Text>
            </Pressable>

            {open ? (
              <DateTimePicker
                value={dayOf(held)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={minimum ? dayOf(minimum) : undefined}
                maximumDate={maximum ? dayOf(maximum) : undefined}
                onValueChange={chosen}
                onDismiss={() => setOpen(false)}
              />
            ) : null}

            {message ? (
              <Text
                className={cn(
                  'text-sm',
                  fieldState.error ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {message}
              </Text>
            ) : null}
          </View>
        );
      }}
    />
  );
}

/** Built from the parts, never parsed: `new Date('1998-02-03')` is UTC midnight, a day early west of it. */
function dayOf(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}
