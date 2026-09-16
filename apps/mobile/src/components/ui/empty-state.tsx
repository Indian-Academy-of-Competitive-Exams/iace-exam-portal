/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import { CircleX, Inbox, Lock, SearchX, type LucideIcon } from 'lucide-react-native';
import { cn } from '../../lib/cn';
import { Button } from './button';

/** The four absences a region can have. The glyph says which one before a word is read. */
export const EMPTY_STATE_KINDS = {
  EMPTY: 'EMPTY',
  FILTERED: 'FILTERED',
  FAILURE: 'FAILURE',
  REFUSED: 'REFUSED',
} as const;
export type EmptyStateKind = (typeof EMPTY_STATE_KINDS)[keyof typeof EMPTY_STATE_KINDS];

const KIND_ICON: Readonly<Record<EmptyStateKind, LucideIcon>> = {
  EMPTY: Inbox,
  FILTERED: SearchX,
  FAILURE: CircleX,
  REFUSED: Lock,
};

/** The disc's fill — a class, since a plain View's background is styleable by className. */
const KIND_DISC: Readonly<Record<EmptyStateKind, string>> = {
  EMPTY: 'bg-[var(--empty-icon-bg)]',
  FILTERED: 'bg-[var(--empty-icon-bg)]',
  // No `--destructive-subtle` token exists yet, so failure reads as a solid disc instead of a tint.
  FAILURE: 'bg-destructive',
  REFUSED: 'bg-warning-subtle',
};

/** The glyph's stroke — a resolved token value, since react-native-svg takes `color`, not className. */
const KIND_GLYPH_TOKEN: Readonly<Record<EmptyStateKind, string>> = {
  EMPTY: '--empty-icon',
  FILTERED: '--empty-icon',
  FAILURE: '--destructive-foreground',
  REFUSED: '--warning-ink',
};

/** What a region shows in place of content. A bare string is its title and nothing else. */
export interface EmptyCopy {
  /** The plain noun for what is absent. Never a sentence about the reader. */
  title: string;
  /** A rule or consequence they cannot read off the screen. */
  hint?: string;
  /** The one action that resolves it — Retry on a failure, a way onward from a refusal. */
  action?: ReactNode;
  /** Only where the kind's own glyph would misstate the absence. */
  icon?: LucideIcon;
}

export type EmptyMessage = string | EmptyCopy;

export const emptyCopy = (message: EmptyMessage): EmptyCopy =>
  typeof message === 'string' ? { title: message } : message;

export interface EmptyStateProps extends EmptyCopy {
  kind?: EmptyStateKind;
  /** Draws the Retry when there is no `action` — a failure without one is a dead end. */
  onRetry?: () => void;
  className?: string;
}

export function EmptyState({
  kind = EMPTY_STATE_KINDS.EMPTY,
  icon,
  title,
  hint,
  action,
  onRetry,
  className,
}: Readonly<EmptyStateProps>) {
  const Icon = icon ?? KIND_ICON[kind];
  const glyphColor = useUnstableNativeVariable(KIND_GLYPH_TOKEN[kind]);
  const retry = onRetry ? (
    <Button variant="ghost" size="sm" onPress={onRetry}>
      Retry
    </Button>
  ) : null;

  return (
    <View className={cn('items-center gap-3', className)}>
      <View className={cn('h-12 w-12 items-center justify-center rounded-full', KIND_DISC[kind])}>
        <Icon size={24} color={typeof glyphColor === 'string' ? glyphColor : undefined} />
      </View>
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      {hint ? <Text className="text-center text-sm text-muted-foreground">{hint}</Text> : null}
      {action ?? retry}
    </View>
  );
}
