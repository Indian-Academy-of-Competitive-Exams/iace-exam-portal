/// <reference types="nativewind/types" />
import { Text, View } from 'react-native';
import { cn } from '../../lib/cn';

/** Status pills, the web's own vocabulary. `danger` is crimson, `primary` is brand red. */
const VARIANTS = {
  neutral: { box: 'bg-muted', text: 'text-muted-foreground' },
  primary: { box: 'bg-primary-subtle', text: 'text-primary-ink' },
  success: { box: 'bg-success-subtle', text: 'text-success-ink' },
  warning: { box: 'bg-warning-subtle', text: 'text-warning-ink' },
  danger: { box: 'bg-destructive-subtle', text: 'text-destructive' },
  info: { box: 'bg-info-subtle', text: 'text-info-ink' },
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

export interface BadgeProps {
  variant?: BadgeVariant;
  children: string;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className }: Readonly<BadgeProps>) {
  const style = VARIANTS[variant];
  return (
    <View className={cn('self-start rounded-full px-2.5 py-1', style.box, className)}>
      <Text className={cn('text-2xs font-semibold', style.text)}>{children}</Text>
    </View>
  );
}
