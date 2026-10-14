/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { type LucideIcon } from 'lucide-react-native';
import { Text } from './text';
import { useTokenColor } from '../../lib/use-token-color';

/** A section heading with one muted glyph ahead of it, to scan by. */
export function SectionTitle({
  icon: Icon,
  children,
}: Readonly<{ icon: LucideIcon; children: ReactNode }>) {
  const ink = useTokenColor('--muted-foreground');

  return (
    <View className="flex-row items-center gap-2">
      <Icon size={16} color={ink} />
      <Text variant="section">{children}</Text>
    </View>
  );
}
