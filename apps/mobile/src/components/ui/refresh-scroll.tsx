/// <reference types="nativewind/types" />
import { type ReactNode } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { useTokenColor } from '../../lib/use-token-color';

export interface RefreshScrollProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}

/** A page that pulls to refresh — the touch answer to the web's Retry sitting in a header. */
export function RefreshScroll({ refreshing, onRefresh, children }: Readonly<RefreshScrollProps>) {
  const tint = useTokenColor('--muted-foreground');

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 pb-12 pt-4"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={tint}
          colors={tint ? [tint] : undefined}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
