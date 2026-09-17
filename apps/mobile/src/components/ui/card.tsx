/// <reference types="nativewind/types" />
import { View, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';

/** The shared surface — `rounded-xl border-border shadow-sm` — used as-is, never restyled. */
export function Card({ className, ...props }: Readonly<ViewProps>) {
  return (
    <View
      className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}
      {...props}
    />
  );
}
