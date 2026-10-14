/// <reference types="nativewind/types" />
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Search from 'lucide-react-native/icons/search';
import X from 'lucide-react-native/icons/x';
import { Text } from './text';
import { Button } from './button';
import { useTokenColor } from '../../lib/use-token-color';
import { cn } from '../../lib/cn';

export interface PickerItem {
  value: string;
  label: string;
}

interface FieldProps {
  label?: string;
  items: readonly PickerItem[];
  placeholder: string;
}

/** The touch Combobox, searchable like web's: one choice, picked from a sheet that closes on the tap. */
export function Picker({
  value,
  onChange,
  ...field
}: Readonly<FieldProps & { value: string; onChange: (next: string) => void }>) {
  return <PickerField {...field} isOn={(one) => one === value} onPick={onChange} closeOnPick />;
}

/** The touch MultiCombobox: several ticked in a sheet; choosing none means all of them. */
export function MultiPicker({
  value,
  onChange,
  ...field
}: Readonly<FieldProps & { value: readonly string[]; onChange: (next: string[]) => void }>) {
  return (
    <PickerField
      {...field}
      isOn={(one) => value.includes(one)}
      onPick={(one) =>
        onChange(value.includes(one) ? value.filter((held) => held !== one) : [...value, one])
      }
      onClear={value.length > 0 ? () => onChange([]) : undefined}
    />
  );
}

function PickerField({
  label,
  items,
  placeholder,
  isOn,
  onPick,
  onClear,
  closeOnPick = false,
}: Readonly<
  FieldProps & {
    isOn: (value: string) => boolean;
    onPick: (value: string) => void;
    onClear?: () => void;
    closeOnPick?: boolean;
  }
>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const insets = useSafeAreaInsets();
  const ink = useTokenColor('--muted-foreground');
  const tick = useTokenColor('--primary');
  const placeholderColor = useTokenColor('--placeholder');
  const name = label ?? placeholder;

  const chosen = items.filter((item) => isOn(item.value)).map((item) => item.label);
  const needle = term.trim().toLowerCase();
  const shown = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  const close = () => {
    setOpen(false);
    setTerm('');
  };

  return (
    <View className="gap-1.5">
      {label ? <Text variant="metaStrong">{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        className="h-11 flex-row items-center gap-2 rounded-md border border-input bg-surface px-3"
      >
        <Text
          numberOfLines={1}
          className={cn('flex-1 text-base', chosen.length ? 'text-foreground' : 'text-placeholder')}
        >
          {chosen.length ? chosen.join(', ') : placeholder}
        </Text>
        <ChevronDown size={18} color={ink} />
      </Pressable>

      <Modal transparent visible={open} animationType="slide" onRequestClose={close}>
        {/* The sheet rides up with the keyboard, so the search and its results are never under it. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1 justify-end bg-[var(--overlay-bg)]"
        >
          <Pressable accessibilityLabel="Close" className="flex-1" onPress={close} />
          <View
            className="max-h-[80%] gap-3 rounded-t-2xl bg-surface pt-2"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="flex-row items-center justify-between gap-2 px-4">
              <Text variant="section" numberOfLines={1} className="flex-1">
                {name}
              </Text>
              {onClear ? (
                <Button variant="ghost" size="sm" icon={X} onPress={onClear}>
                  Clear
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" icon={Check} onPress={close}>
                Done
              </Button>
            </View>

            <View className="mx-4 h-11 flex-row items-center gap-2 rounded-md border border-input bg-background px-3">
              <Search size={16} color={ink} />
              <TextInput
                value={term}
                onChangeText={setTerm}
                placeholder={`Search ${name.toLowerCase()}`}
                placeholderTextColor={placeholderColor}
                accessibilityLabel={`Search ${name.toLowerCase()}`}
                className="h-11 flex-1 text-base text-foreground"
              />
            </View>

            <ScrollView className="shrink grow-0" keyboardShouldPersistTaps="handled">
              {shown.length === 0 ? (
                <Text variant="muted" className="px-4 py-3">
                  No match
                </Text>
              ) : (
                shown.map((item) => {
                  const on = isOn(item.value);
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole={closeOnPick ? 'radio' : 'checkbox'}
                      accessibilityState={{ checked: on }}
                      onPress={() => {
                        onPick(item.value);
                        if (closeOnPick) close();
                      }}
                      className={cn(
                        'min-h-12 flex-row items-center gap-3 px-4 py-2',
                        on && 'bg-primary-subtle',
                      )}
                    >
                      <Text className="flex-1 text-base text-foreground">{item.label}</Text>
                      {on ? <Check size={18} color={tick} /> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
