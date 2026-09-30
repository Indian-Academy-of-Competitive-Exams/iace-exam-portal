/**
 * React Native fires no window focus, and the tabs stay mounted, so a screen the
 * student comes back to would otherwise show what it read the first time.
 */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

/** Only what has gone stale, and only what something is watching: within staleTime a tab switch costs nothing. */
export function useRefetchOnFocus(): void {
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      void queryClient.refetchQueries({ type: 'active', stale: true });
    }, [queryClient]),
  );
}
