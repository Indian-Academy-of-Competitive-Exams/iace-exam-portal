/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { type LucideIcon } from 'lucide-react-native';
import { useUnstableNativeVariable } from 'nativewind';
import { cn } from '../../lib/cn';

const VARIANTS = {
  info: { box: 'border-info bg-info-subtle', text: 'text-info-ink', ink: '--info-ink' },
  success: {
    box: 'border-success bg-success-subtle',
    text: 'text-success-ink',
    ink: '--success-ink',
  },
  warning: {
    box: 'border-warning bg-warning-subtle',
    text: 'text-warning-ink',
    ink: '--warning-ink',
  },
  danger: {
    box: 'border-destructive bg-destructive-subtle',
    text: 'text-destructive',
    ink: '--destructive',
  },
} as const;

export interface AlertProps extends ViewProps {
  variant?: keyof typeof VARIANTS;
  /** A glyph leading the line, in the alert's own ink. */
  icon?: LucideIcon;
  /** The action that resolves it, inside the alert. */
  action?: ReactNode;
  children: ReactNode;
}

/** A reader-facing fact, never muted prose on the page. `danger` is a real restriction, not a tip. */
export function Alert({
  variant = 'info',
  icon: Icon,
  action,
  className,
  children,
  ...props
}: Readonly<AlertProps>) {
  const style = VARIANTS[variant];
  const ink: unknown = useUnstableNativeVariable(style.ink);

  return (
    <View className={cn('gap-3 rounded-lg border px-3.5 py-3', style.box, className)} {...props}>
      <View className="flex-row items-start gap-2">
        {Icon ? (
          <View className="pt-0.5">
            <Icon size={16} color={typeof ink === 'string' ? ink : undefined} />
          </View>
        ) : null}
        <Text className={cn('flex-1 text-sm', style.text)}>{children}</Text>
      </View>
      {action}
    </View>
  );
}
