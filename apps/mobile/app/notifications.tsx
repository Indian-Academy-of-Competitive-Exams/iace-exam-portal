/// <reference types="nativewind/types" />
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NOTIFICATION_FILTERS, READ_STATE, useInfinitePages } from '@iace/app-kit';
import { instituteDayLabel, type Notification } from '@iace/contracts';
import { api } from '../src/lib/api';
import { notificationsQueryKey, UNREAD_QUERY_KEY } from '../src/lib/constants';
import { DETAIL_ROUTES } from '../src/lib/nav';
import { useTokenColor } from '../src/lib/use-token-color';
import { asText, useFilterState } from '../src/lib/filters';
import { Badge } from '../src/components/ui/badge';
import { Card } from '../src/components/ui/card';
import { FilterBar } from '../src/components/ui/filter-bar';
import { EmptyState, EMPTY_STATE_KINDS } from '../src/components/ui/empty-state';
import { Skeleton } from '../src/components/ui/skeleton';

/** What the institute has told this student, newest first. Opening one marks it read. */
export default function NotificationsScreen() {
  const state = useFilterState(NOTIFICATION_FILTERS);
  const unreadOnly = asText(state.values.state) === READ_STATE.UNREAD;
  const queryClient = useQueryClient();
  const router = useRouter();
  const spinner = useTokenColor('--muted-foreground');

  const list = useInfinitePages({
    queryKey: notificationsQueryKey(unreadOnly),
    fetchPage: (page) =>
      api.me.notifications({ page, unreadOnly: unreadOnly ? 'true' : undefined }),
  });

  const read = useMutation({
    mutationFn: (id: string) => api.me.readNotification(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
      void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
    },
  });

  const open = (row: Notification) => {
    if (!row.isRead) read.mutate(row.id);
    if (row.testId) router.navigate(DETAIL_ROUTES.TEST(row.testId));
    else if (row.testSeriesId) router.navigate(DETAIL_ROUTES.SERIES(row.testSeriesId));
  };

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerStyle={CONTENT_STYLE}
      data={list.items}
      keyExtractor={(row) => row.id}
      onEndReachedThreshold={0.5}
      onEndReached={list.loadMore}
      renderItem={({ item }) => <Row row={item} onPress={() => open(item)} />}
      ListHeaderComponent={<FilterBar state={state} filters={NOTIFICATION_FILTERS} />}
      ListEmptyComponent={<ListBody list={list} unreadOnly={unreadOnly} />}
      ListFooterComponent={
        list.isLoadingMore ? <ActivityIndicator className="py-4" color={spinner} /> : null
      }
    />
  );
}

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 12 };

function ListBody({
  list,
  unreadOnly,
}: Readonly<{
  list: { isLoading: boolean; isError: boolean; retry: () => void };
  unreadOnly: boolean;
}>) {
  if (list.isLoading) {
    return (
      <View className="gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </View>
    );
  }
  if (list.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your notifications did not load"
        onRetry={list.retry}
      />
    );
  }
  return unreadOnly ? (
    <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing unread" />
  ) : (
    <EmptyState title="No notifications yet" />
  );
}

function Row({ row, onPress }: Readonly<{ row: Notification; onPress: () => void }>) {
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={onPress} className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1 text-base font-semibold text-foreground">{row.title}</Text>
          {row.isRead ? null : <Badge variant="primary">New</Badge>}
        </View>
        {row.body ? <Text className="text-sm text-foreground">{row.body}</Text> : null}
        <Text className="text-xs text-muted-foreground">{instituteDayLabel(row.createdAt)}</Text>
      </Pressable>
    </Card>
  );
}
