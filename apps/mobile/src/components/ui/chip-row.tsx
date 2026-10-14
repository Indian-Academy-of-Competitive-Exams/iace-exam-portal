/// <reference types="nativewind/types" />
import { Pressable, ScrollView, View } from 'react-native';
import { type LucideIcon } from 'lucide-react-native';
import { Text } from './text';
import { useTokenColor } from '../../lib/use-token-color';
import { cn } from '../../lib/cn';

export interface ChipOption {
  value: string;
  label: string;
  icon?: LucideIcon;
}

export interface ChipRowProps {
  options: readonly ChipOption[];
  value: string;
  onChange: (value: string) => void;
  /** A filter names what it narrows; a switch between views of one record has nothing to name. */
  label?: string;
  /** A glyph leading the label. */
  labelIcon?: LucideIcon;
  /** More chips than a phone is wide: they scroll sideways rather than wrapping to three rows. */
  scroll?: boolean;
  className?: string;
}

/** One choice out of a few, as chips — the touch answer to a Combobox on a screen this narrow. */
export function ChipRow({
  label,
  labelIcon: LabelIcon,
  options,
  value,
  onChange,
  scroll = false,
  className,
}: Readonly<ChipRowProps>) {
  const muted = useTokenColor('--muted-foreground');
  const chips = options.map((option) => (
    <Chip
      key={option.value}
      label={option.label}
      icon={option.icon}
      selected={option.value === value}
      onPress={() => onChange(option.value)}
    />
  ));

  return (
    <View className={cn('gap-1.5', className)}>
      {label ? (
        <View className="flex-row items-center gap-1.5">
          {LabelIcon ? <LabelIcon size={16} color={muted} /> : null}
          <Text variant="metaStrong">{label}</Text>
        </View>
      ) : null}
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
  icon: Icon,
  selected,
  onPress,
}: Readonly<{ label: string; icon?: LucideIcon; selected: boolean; onPress: () => void }>) {
  const ink = useTokenColor(selected ? '--primary-ink' : '--foreground');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
        selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
      )}
    >
      {Icon ? <Icon size={14} color={ink} /> : null}
      <Text
        className={cn('text-xs font-medium', selected ? 'text-primary-ink' : 'text-foreground')}
      >
        {label}
      </Text>
    </Pressable>
  );
}
