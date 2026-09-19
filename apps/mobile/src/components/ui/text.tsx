/// <reference types="nativewind/types" />
import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';
import { cn } from '../../lib/cn';

/** The type ramp, named. A screen picks the role; it never spells the size and weight itself. */
const VARIANTS = {
  title: 'text-2xl font-bold tracking-tight text-foreground',
  section: 'text-lg font-semibold text-foreground',
  subsection: 'text-sm font-semibold text-foreground',
  label: 'text-sm font-medium text-foreground',
  body: 'text-sm text-foreground',
  muted: 'text-sm text-muted-foreground',
  meta: 'text-xs text-muted-foreground',
  metaStrong: 'text-xs font-medium text-muted-foreground',
} as const;

export type TextVariant = keyof typeof VARIANTS;

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
}

// No default: cn here only joins, so a ramp under a caller's own size or colour would collide.
export function Text({ variant, className, ...props }: Readonly<TextProps>) {
  return <NativeText className={cn(variant && VARIANTS[variant], className)} {...props} />;
}
