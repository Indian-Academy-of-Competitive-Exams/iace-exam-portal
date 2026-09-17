/// <reference types="nativewind/types" />
import { Pressable, ScrollView, Text, View } from 'react-native';
import { cn } from '../../lib/cn';

export interface ChipOption {
  value: string;
  label: string;
}

export interface ChipRowProps {
  options: readonly ChipOption[];
  value: string;
  onChange: (value: string) => void;
  /** A filter names what it narrows; a switch between views of one record has nothing to name. */
  label?: string;
  /** More chips than a phone is wide: they scroll sideways rather than wrapping to three rows. */
  scroll?: boolean;
  className?: string;
}

/** One choice out of a few, as chips — the touch answer to a Combobox on a screen this narrow. */
export function ChipRow({
  label,
  options,
  value,
  onChange,
  scroll = false,
  className,
}: Readonly<ChipRowProps>) {
  const chips = options.map((option) => (
    <Chip
      key={option.value}
      label={option.label}
      selected={option.value === value}
      onPress={() => onChange(option.value)}
    />
  ));

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? <Text className="text-xs font-medium text-muted-foreground">{label}</Text> : null}
      {scroll ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row gap-2 pr-5"
        >
          {chips}
        </ScrollView>
      ) : (
        <View className="flex-row flex-wrap gap-2">{chips}</View>
      )}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: Readonly<{ label: string; selected: boolean; onPress: () => void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'rounded-full border px-3 py-1.5',
        selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
      )}
    >
      <Text
        className={cn('text-xs font-medium', selected ? 'text-primary-ink' : 'text-foreground')}
      >
        {label}
      </Text>
    </Pressable>
  );
}
