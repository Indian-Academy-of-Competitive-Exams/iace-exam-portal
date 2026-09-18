/**
 * The web's PinInput on a phone: one real input under N boxes, so autofill, paste
 * and the SMS suggestion all still work while the boxes stay a rendering. The caret
 * is pinned to the end — there is no mid-value editing to design for.
 */
/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { cn } from '../../lib/cn';

const DOT = '•';

/** Boxes share the width up to a cap, so four of them in a narrow form stay square. */
const BOX = 'h-12 max-w-14 flex-1 items-center justify-center rounded-md border bg-surface';

export interface PinFieldProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: Path<TValues>;
  label: string;
  /** A PIN is 4. An OTP is whatever the server said — never assume six. */
  length: number;
  /** Dots instead of digits. A PIN is a secret; an emailed code is not. */
  masked?: boolean;
  hint?: string;
  autoFocus?: boolean;
}

export function PinField<TValues extends FieldValues>({
  control,
  name,
  label,
  length,
  masked = false,
  hint,
  autoFocus,
}: Readonly<PinFieldProps<TValues>>) {
  const [focused, setFocused] = useState(false);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const held = typeof field.value === 'string' ? field.value : '';
        // The hint gives way to the error rather than stacking, so the height never changes.
        const message = fieldState.error?.message ?? hint;
        // The box the next keystroke lands in. Clamped, so a full value highlights the last.
        const active = Math.min(held.length, length - 1);

        return (
          <View className="flex flex-col gap-1.5">
            <Text className="text-sm font-medium text-foreground">{label}</Text>

            <View className="relative">
              <View className="flex-row gap-2">
                {Array.from({ length }, (_, index) => (
                  <View
                    key={index}
                    className={cn(
                      BOX,
                      focused && index === active ? 'border-ring' : 'border-input',
                      fieldState.error && 'border-destructive',
                    )}
                  >
                    <Text className="text-lg font-medium text-foreground">
                      {cellOf(held[index], masked)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Invisible, not hidden: it lies OVER the boxes, so a tap lands on it and it fills. */}
              <TextInput
                accessibilityLabel={label}
                value={held}
                onChangeText={(raw) => field.onChange(raw.replace(/\D/g, '').slice(0, length))}
                onFocus={() => setFocused(true)}
                onBlur={() => {
                  setFocused(false);
                  field.onBlur();
                }}
                keyboardType="number-pad"
                maxLength={length}
                autoFocus={autoFocus}
                caretHidden
                // Concealment is drawn, not native: secureTextEntry would fight the number pad.
                autoComplete={masked ? 'password' : 'sms-otp'}
                textContentType={masked ? 'password' : 'oneTimeCode'}
                className="absolute inset-0 h-full w-full text-transparent opacity-0"
              />
            </View>

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

/** A filled box: the digit, or the dot standing in for it. An empty one holds a space, not nothing. */
function cellOf(digit: string | undefined, masked: boolean): string {
  if (digit === undefined) return ' ';
  return masked ? DOT : digit;
}
