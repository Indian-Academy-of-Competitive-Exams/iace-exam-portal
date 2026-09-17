/// <reference types="nativewind/types" />
import { Text, View } from 'react-native';
import { cn } from '../../lib/cn';

/** Which hue a bar wears. Identity only — a magnitude comparison leaves them all on one. */
const TONES = {
  1: 'bg-series-1',
  2: 'bg-series-2',
  3: 'bg-series-3',
} as const;

export type MeasureTone = keyof typeof TONES;

export interface MeasureBar {
  key: string;
  label: string;
  value: number;
  /** What the row says on its right. Defaults to the value — pass a formatted one instead. */
  display?: string;
  /** The n behind the value, written beside it so the fill is never read without its sample. */
  meta?: string;
  /** Too few behind it to stand beside the rest: drawn as a wash rather than a reading. */
  faint?: boolean;
  tone?: MeasureTone;
}

export interface MeasureBarsProps {
  bars: readonly MeasureBar[];
  /** The top of the scale. Every bar is read against this one number, never against each other. */
  max: number;
  className?: string;
}

/** The web's MeasureBars on a phone: the label rides above its own track, not beside it. */
export function MeasureBars({ bars, max, className }: Readonly<MeasureBarsProps>) {
  const ceiling = Math.max(max, ...bars.map((bar) => bar.value), 1);

  return (
    <View className={cn('gap-3', className)}>
      {bars.map((bar) => (
        <View key={bar.key} className="gap-1">
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="flex-1 text-sm text-muted-foreground" numberOfLines={1}>
              {bar.label}
            </Text>
            <Text
              className={cn(
                'text-sm font-medium',
                bar.faint ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {bar.display ?? bar.value}
            </Text>
            {bar.meta === undefined ? null : (
              <Text className="text-xs text-muted-foreground">{bar.meta}</Text>
            )}
          </View>
          <View className="h-2 overflow-hidden rounded-full bg-muted">
            <View
              className={cn('h-2 rounded-full', TONES[bar.tone ?? 1], bar.faint && 'opacity-40')}
              style={{ width: `${share(bar.value, ceiling)}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const share = (value: number, ceiling: number) => Math.max(0, Math.min(value / ceiling, 1)) * 100;
