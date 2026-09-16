/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { cn } from '../../lib/cn';

export interface AlertProps extends ViewProps {
  children: ReactNode;
}

/** A reader-facing fact, never muted prose on the page — info only, the one kind this screen needs. */
export function Alert({ className, children, ...props }: Readonly<AlertProps>) {
  return (
    <View
      className={cn('rounded-lg border border-info bg-info-subtle px-3.5 py-3', className)}
      {...props}
    >
      <Text className="text-sm text-info-ink">{children}</Text>
    </View>
  );
}
