/// <reference types="nativewind/types" />
import { View, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';

/** A static placeholder the shape of the content it stands in for, while a query is in flight. */
export function Skeleton({ className, ...props }: Readonly<ViewProps>) {
  return <View className={cn('bg-muted', className)} {...props} />;
}
