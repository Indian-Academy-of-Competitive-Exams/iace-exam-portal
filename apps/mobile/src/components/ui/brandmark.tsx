/// <reference types="nativewind/types" />
import { View } from 'react-native';
import { Text } from './text';
import { cn } from '../../lib/cn';

export interface BrandmarkProps {
  portal?: string;
  className?: string;
}

/** The IACE lockup: the name on a brand-red plate, matching packages/ui Brandmark. */
export function Brandmark({ portal, className }: Readonly<BrandmarkProps>) {
  return (
    <View className={cn('flex-row items-center gap-3', className)}>
      <View className="rounded-md bg-primary px-6 py-2.5">
        <Text className="text-3xl font-extrabold tracking-brand text-primary-foreground">IACE</Text>
      </View>
      {portal ? (
        <Text className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {portal}
        </Text>
      ) : null}
    </View>
  );
}
