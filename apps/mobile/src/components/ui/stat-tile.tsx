/// <reference types="nativewind/types" />
import { Text } from 'react-native';
import { Card } from './card';
import { cn } from '../../lib/cn';

export interface StatTileProps {
  label: string;
  value: string | number;
  className?: string;
}

/** A labelled figure in a Card — the paper's own facts, read before the clock starts. */
export function StatTile({ label, value, className }: Readonly<StatTileProps>) {
  return (
    <Card className={cn('min-w-[7rem] flex-1 gap-1 p-4', className)}>
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-xl font-semibold text-foreground">{value}</Text>
    </Card>
  );
}
