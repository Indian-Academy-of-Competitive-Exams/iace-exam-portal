/// <reference types="nativewind/types" />
import { View, type ViewProps } from 'react-native';
import { Text } from './text';
import { Card } from './card';
import { type LucideIcon } from 'lucide-react-native';
import { cn } from '../../lib/cn';
import { useTokenColor } from '../../lib/use-token-color';

export interface StatTileProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  className?: string;
}

/** A labelled figure in a Card — the paper's own facts, read before the clock starts. */
export function StatTile({ label, value, icon: Icon, className }: Readonly<StatTileProps>) {
  const ink = useTokenColor('--muted-foreground');

  return (
    <Card className={cn('min-w-[7rem] flex-1 gap-1 p-4', className)}>
      <View className="flex-row items-center gap-1.5">
        {Icon ? <Icon size={14} color={ink} /> : null}
        <Text variant="meta">{label}</Text>
      </View>
      <Text className="text-xl font-semibold text-foreground">{value}</Text>
    </Card>
  );
}

// Wrapping tiles stretch to the tallest on their line, which is what keeps a wrapped row even.
export function StatTileRow({ className, ...props }: Readonly<ViewProps>) {
  return <View className={cn('flex-row flex-wrap gap-3', className)} {...props} />;
}
