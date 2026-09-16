/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';

// No `--destructive-subtle` token exists, so danger reads as a solid fill rather than a tint.
const VARIANTS = {
  info: { box: 'border-info bg-info-subtle', text: 'text-info-ink' },
  danger: { box: 'border-destructive bg-destructive', text: 'text-destructive-foreground' },
} as const;

export interface AlertProps extends ViewProps {
  variant?: keyof typeof VARIANTS;
  children: ReactNode;
}

/** A reader-facing fact, never muted prose on the page. `danger` is a real restriction, not a tip. */
export function Alert({ variant = 'info', className, children, ...props }: Readonly<AlertProps>) {
  const style = VARIANTS[variant];
  return (
    <View className={cn('rounded-lg border px-3.5 py-3', style.box, className)} {...props}>
      <Text className={cn('text-sm', style.text)}>{children}</Text>
    </View>
  );
}
