/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './text';
import { cn } from '../../lib/cn';

export interface HeroProps {
  /** The overline above the title — where this sits, in the exam world's own words. */
  eyebrow?: string;
  /** Omitted where the figure IS the headline and a title would only repeat the screen's. */
  title?: string;
  /** A value under the title. Never a sentence about the screen. */
  meta?: string;
  children?: ReactNode;
  className?: string;
}

/** The focal element a primary screen opens on, before its supporting grid. */
export function Hero({ eyebrow, title, meta, children, className }: Readonly<HeroProps>) {
  return (
    <View
      className={cn(
        // No gradient: React Native has no CSS one, and a second surface token would be a fork.
        'gap-2 rounded-2xl border border-border bg-primary-subtle p-5',
        className,
      )}
    >
      {eyebrow ? (
        <Text className="text-xs font-semibold uppercase tracking-wide text-primary-ink">
          {eyebrow}
        </Text>
      ) : null}
      {title ? <Text variant="title">{title}</Text> : null}
      {meta ? <Text variant="muted">{meta}</Text> : null}
      {children}
    </View>
  );
}

export interface HeroFigureProps {
  value: string | number;
  /** A VALUE qualifying the number — an ordinal suffix, "/ 200", "%". Never a sentence. */
  unit?: string;
  /** What the number IS, written under it so the figure never stands unlabelled. */
  caption?: string;
}

/** The hero's number at the top of the ramp, where `--text-3xl` is already the KPI step. */
export function HeroFigure({ value, unit, caption }: Readonly<HeroFigureProps>) {
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline gap-1.5">
        <Text className="text-3xl font-bold tracking-tight text-primary-ink">{value}</Text>
        {unit ? <Text className="text-lg font-semibold text-primary-ink">{unit}</Text> : null}
      </View>
      {caption ? <Text variant="muted">{caption}</Text> : null}
    </View>
  );
}

/** Every screen's own title. The page step (28), never the hero figure's (36). */
export function ScreenTitle({
  children,
  meta,
  action,
}: Readonly<{ children: string; meta?: string; action?: ReactNode }>) {
  const titled = (
    <View className={cn('gap-0.5', action ? 'min-w-0 flex-1' : undefined)}>
      <Text variant="title">{children}</Text>
      {meta ? <Text variant="muted">{meta}</Text> : null}
    </View>
  );

  // A row only where there is something to sit beside the title; otherwise the column it always was.
  return action ? (
    <View className="flex-row items-center gap-3">
      {titled}
      {action}
    </View>
  ) : (
    titled
  );
}
