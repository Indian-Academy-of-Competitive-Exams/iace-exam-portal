/// <reference types="nativewind/types" />
import { TextInput, View, type TextInputProps } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Text } from './text';
import { cn } from '../../lib/cn';

export interface TextFieldProps<TValues extends FieldValues> extends Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'onBlur'
> {
  control: Control<TValues>;
  name: Path<TValues>;
  label: string;
  /** Standing guidance — shown until an error replaces it. */
  hint?: string;
  /** Rewrites what the user typed, e.g. digits-only plus a length cap. */
  sanitize?: (raw: string) => string;
}

/** A labelled TextInput bound to one react-hook-form field, its error below it. */
export function TextField<TValues extends FieldValues>({
  control,
  name,
  label,
  hint,
  sanitize,
  className,
  ...inputProps
}: Readonly<TextFieldProps<TValues>>) {
  const placeholderColor = useUnstableNativeVariable('--placeholder');

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        // The hint gives way to the error rather than stacking, so the height never changes.
        const message = fieldState.error?.message ?? hint;

        return (
          <View className="flex flex-col gap-1.5">
            <Text variant="label">{label}</Text>
            <TextInput
              {...inputProps}
              value={typeof field.value === 'string' ? field.value : ''}
              onBlur={field.onBlur}
              onChangeText={(raw) => field.onChange(sanitize ? sanitize(raw) : raw)}
              placeholderTextColor={
                typeof placeholderColor === 'string' ? placeholderColor : undefined
              }
              className={cn(
                'h-11 rounded-md border border-input bg-surface px-3 text-base text-foreground',
                fieldState.error && 'border-destructive',
                className,
              )}
            />
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
