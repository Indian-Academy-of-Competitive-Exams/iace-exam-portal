/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import { cn } from '../../lib/cn';

const VARIANTS = {
  default: 'bg-primary',
  secondary: 'bg-secondary',
  destructive: 'bg-destructive',
  warning: 'bg-warning-solid',
  outline: 'border border-border bg-surface',
  ghost: 'bg-transparent',
} as const;
const TEXT_VARIANTS = {
  default: 'text-primary-foreground',
  secondary: 'text-secondary-foreground',
  destructive: 'text-destructive-foreground',
  warning: 'text-primary-foreground',
  outline: 'text-foreground',
  ghost: 'text-foreground',
} as const;
/** A filled control reads as off by going grey, not by fading; outline keeps its fill, ghost has none. */
const OFF_VARIANTS = {
  default: 'bg-disabled',
  secondary: 'bg-disabled',
  destructive: 'bg-disabled',
  warning: 'bg-disabled',
  outline: 'border-disabled-border bg-disabled',
  ghost: '',
} as const;
/** The native `ActivityIndicator.color` prop takes a resolved value, not a class — read the token. */
const SPINNER_TOKEN = {
  default: '--primary-foreground',
  secondary: '--secondary-foreground',
  destructive: '--destructive-foreground',
  warning: '--primary-foreground',
  outline: '--foreground',
  ghost: '--foreground',
} as const;

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  variant?: keyof typeof VARIANTS;
  size?: 'default' | 'sm';
  loading?: boolean;
  /** Leading glyph; `loading` swaps it for the spinner. */
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** Brick is the sparing CTA (`bg-primary`); ghost carries no fill, the Back action's weight. */
export function Button({
  variant = 'default',
  size = 'default',
  loading = false,
  icon: Icon,
  disabled,
  children,
  className,
  ...props
}: Readonly<ButtonProps>) {
  const spinnerColor = useUnstableNativeVariable(SPINNER_TOKEN[variant]);
  const offInk = useUnstableNativeVariable('--disabled-fg');
  const isOff = Boolean(disabled) || loading;
  const isDisabled = Boolean(disabled);
  const ink = typeof spinnerColor === 'string' ? spinnerColor : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy: loading }}
      disabled={isOff}
      className={cn(
        // h-11 is --control-h-lg, the 44px touch floor: a small button narrows, never shortens.
        'h-11 flex-row items-center justify-center gap-2 rounded-md',
        size === 'sm' ? 'px-3' : 'px-4',
        VARIANTS[variant],
        isDisabled && OFF_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <ActivityIndicator color={ink} /> : null}
      {Icon && !loading ? (
        <Icon size={16} color={isDisabled && typeof offInk === 'string' ? offInk : ink} />
      ) : null}
      <Text
        className={cn(
          'text-sm font-medium',
          isDisabled ? 'text-disabled-foreground' : TEXT_VARIANTS[variant],
        )}
      >
        {children}
      </Text>
    </Pressable>
  );
}
