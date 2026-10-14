/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';

const VARIANTS = {
  info: { box: 'border-info bg-info-subtle', text: 'text-info-ink' },
  success: { box: 'border-success bg-success-subtle', text: 'text-success-ink' },
  warning: { box: 'border-warning bg-warning-subtle', text: 'text-warning-ink' },
  danger: { box: 'border-destructive bg-destructive-subtle', text: 'text-destructive' },
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
