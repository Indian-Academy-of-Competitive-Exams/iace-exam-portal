/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import { cn } from '../../lib/cn';

const VARIANTS = { default: 'bg-primary', ghost: 'bg-transparent' } as const;
const TEXT_VARIANTS = { default: 'text-primary-foreground', ghost: 'text-foreground' } as const;
/** The native `ActivityIndicator.color` prop takes a resolved value, not a class — read the token. */
const SPINNER_TOKEN = { default: '--primary-foreground', ghost: '--foreground' } as const;

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  variant?: keyof typeof VARIANTS;
  size?: 'default' | 'sm';
  loading?: boolean;
  children: ReactNode;
  className?: string;
}

/** Brick is the sparing CTA (`bg-primary`); ghost carries no fill, the Back action's weight. */
export function Button({
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  children,
  className,
  ...props
}: Readonly<ButtonProps>) {
  const spinnerColor = useUnstableNativeVariable(SPINNER_TOKEN[variant]);
  const isOff = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy: loading }}
      disabled={isOff}
      className={cn(
        'flex-row items-center justify-center gap-2 rounded-md',
        size === 'sm' ? 'h-8 px-3' : 'h-11 px-4',
        VARIANTS[variant],
        isOff && 'opacity-50',
        className,
      )}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={typeof spinnerColor === 'string' ? spinnerColor : undefined} />
      ) : null}
      <Text className={cn('text-sm font-medium', TEXT_VARIANTS[variant])}>{children}</Text>
    </Pressable>
  );
}
