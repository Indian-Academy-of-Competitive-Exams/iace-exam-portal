/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import { Text } from './text';
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

/** Past this many rows a list is searched, not scanned. */
const SEARCH_FROM = 7;

/** The touch Combobox: one choice, named on the field, the list opening in place. */
export function Picker({
  value,
  onChange,
  ...field
}: Readonly<FieldProps & { value: string; onChange: (next: string) => void }>) {
  return <PickerField {...field} isOn={(one) => one === value} onPick={onChange} closeOnPick />;
}

/** The touch MultiCombobox: several ticked in place; choosing none means all of them. */
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
    />
  );
}

function PickerField({
  label,
  items,
  placeholder,
  isOn,
  onPick,
  closeOnPick = false,
}: Readonly<
  FieldProps & {
    isOn: (value: string) => boolean;
    onPick: (value: string) => void;
    closeOnPick?: boolean;
  }
>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const ink = useTokenColor('--muted-foreground');
  const tick = useTokenColor('--primary');
  const placeholderColor = useTokenColor('--placeholder');
  const name = label ?? placeholder;

  const chosen = items.filter((item) => isOn(item.value)).map((item) => item.label);
  const needle = term.trim().toLowerCase();
  const shown = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View className="gap-1.5">
      {label ? <Text variant="metaStrong">{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        className="h-11 flex-row items-center gap-2 rounded-md border border-input bg-surface px-3"
      >
        <Text
          numberOfLines={1}
          className={cn('flex-1 text-base', chosen.length ? 'text-foreground' : 'text-placeholder')}
        >
          {chosen.length ? chosen.join(', ') : placeholder}
        </Text>
        <Chevron size={18} color={ink} />
      </Pressable>

      {open ? (
        <View className="overflow-hidden rounded-md border border-border bg-surface">
          {items.length >= SEARCH_FROM ? (
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder={`Search ${name.toLowerCase()}`}
              placeholderTextColor={placeholderColor}
              accessibilityLabel={`Search ${name.toLowerCase()}`}
              className="h-11 border-b border-border px-3 text-base text-foreground"
            />
          ) : null}
          <ScrollView className="max-h-64" nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {shown.length === 0 ? (
              <Text variant="muted" className="p-3">
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
                      if (closeOnPick) setOpen(false);
                    }}
                    className={cn(
                      'min-h-11 flex-row items-center gap-3 px-3 py-2',
                      on && 'bg-primary-subtle',
                    )}
                  >
                    <Text className="flex-1 text-base text-foreground">{item.label}</Text>
                    {on ? <Check size={16} color={tick} /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
