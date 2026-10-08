/// <reference types="nativewind/types" />
import { ActivityIndicator } from 'react-native';
import { useTokenColor } from '../../lib/use-token-color';
import { EmptyState, EMPTY_STATE_KINDS } from './empty-state';

export interface ListFooterProps {
  list: { isLoadingMore: boolean; isLoadMoreError: boolean; loadMore: () => void };
}

/** The end of a paged list: the next page arriving, or the way to ask again for one that did not. */
export function ListFooter({ list }: Readonly<ListFooterProps>) {
  const spinner = useTokenColor('--muted-foreground');

  if (list.isLoadingMore) return <ActivityIndicator className="py-4" color={spinner} />;
  if (!list.isLoadMoreError) return null;
  return (
    <EmptyState
      kind={EMPTY_STATE_KINDS.FAILURE}
      title="Could not load more"
      onRetry={list.loadMore}
    />
  );
}
