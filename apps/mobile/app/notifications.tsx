/// <reference types="nativewind/types" />
import { useCallback } from 'react';
import { FlatList, Pressable, View, type ViewToken } from 'react-native';
import Settings from 'lucide-react-native/icons/settings';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  markNotificationRead,
  NOTIFICATION_FILTERS,
  notificationKindOf,
  notificationQuery,
  useInfinitePages,
} from '@iace/app-kit';
import { instituteDateTimeLabel, type Notification } from '@iace/contracts';
import { Text } from '../src/components/ui/text';
import { api } from '../src/lib/api';
import { notificationsQueryKey, UNREAD_QUERY_KEY } from '../src/lib/constants';
import { ACCOUNT_ROUTES, DETAIL_ROUTES } from '../src/lib/nav';
import { asText, useFilterState, type FilterState } from '../src/lib/filters';
import { useSettled } from '../src/lib/use-settled';
import { Badge } from '../src/components/ui/badge';
import { Button } from '../src/components/ui/button';
import { Card } from '../src/components/ui/card';
import { FilterSearch, FilterSummary, FilterTrigger } from '../src/components/ui/filter-bar';
import { EmptyState } from '../src/components/ui/empty-state';
import { EMPTY_STATE_KINDS } from '../src/components/ui/empty-state-kinds';
import { ListFooter } from '../src/components/ui/list-footer';
import { Skeleton } from '../src/components/ui/skeleton';

/** What the institute has told this student, newest first. Opening one marks it read. */
export default function NotificationsScreen() {
  const state = useFilterState(NOTIFICATION_FILTERS);
  const search = useSettled(asText(state.values.q));
  const query = notificationQuery({ ...state.values, q: search });
  const queryClient = useQueryClient();
  const router = useRouter();

  const list = useInfinitePages({
    queryKey: notificationsQueryKey(query),
    fetchPage: (page, _signal, after) => api.me.notifications({ ...query, page, cursor: after }),
    cursorOf: (row) => row.id,
  });

  const read = useMutation({
    mutationFn: (id: string) => api.me.readNotification(id),
    // Patched, as the web does: invalidating the prefix refetched every loaded page plus the count, per tap.
    onSuccess: (_data, id) => markNotificationRead(queryClient, id),
    onError: () => void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY }),
  });

  // `mutate` is stable, which FlatList requires of this callback.
  const { mutate: markRead } = read;
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Notification>[] }) => {
      for (const { item } of viewableItems) if (item && !item.isRead) markRead(item.id);
    },
    [markRead],
  );

  const open = (row: Notification) => {
    if (!row.isRead) read.mutate(row.id);
    if (row.testId) router.navigate(DETAIL_ROUTES.TEST(row.testId));
    else if (row.testSeriesId) router.navigate(DETAIL_ROUTES.SERIES(row.testSeriesId));
    else if (row.ticketId) router.navigate(DETAIL_ROUTES.HELP_QUERY(row.ticketId));
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: headerActions(state, () =>
            router.navigate(ACCOUNT_ROUTES.NOTIFICATION_SETTINGS),
          ),
        }}
      />
      <FlatList
        className="flex-1 bg-background"
        contentContainerStyle={CONTENT_STYLE}
        data={list.items}
        keyExtractor={(row) => row.id}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABLE}
        onEndReachedThreshold={0.5}
        // A failed page is asked for again by the footer's Retry: its changing height would have the scroll ask in a loop.
        onEndReached={list.isLoadMoreError ? undefined : list.loadMore}
        renderItem={({ item }) => <Row row={item} onPress={() => open(item)} />}
        ListHeaderComponent={
          <View className="gap-3">
            <FilterSearch state={state} filters={NOTIFICATION_FILTERS} />
            <FilterSummary state={state} filters={NOTIFICATION_FILTERS} />
          </View>
        }
        ListEmptyComponent={<ListBody list={list} filtered={state.activeCount > 0} />}
        ListFooterComponent={<ListFooter list={list} />}
      />
    </>
  );
}

const VIEWABLE = { itemVisiblePercentThreshold: 50, minimumViewTime: 500 };

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 12 };

/** A header action is a render function the navigator calls, so it is built outside the screen. */
const headerActions = (state: FilterState, settings: () => void) => () => (
  <View className="flex-row items-center gap-2">
    <FilterTrigger bare state={state} filters={NOTIFICATION_FILTERS} />
    <Button variant="ghost" size="sm" icon={Settings} onPress={settings}>
      Settings
    </Button>
  </View>
);

function ListBody({
  list,
  filtered,
}: Readonly<{
  list: { isLoading: boolean; isError: boolean; retry: () => void };
  filtered: boolean;
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
  return filtered ? (
    <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />
  ) : (
    <EmptyState title="No notifications yet" />
  );
}

function Row({ row, onPress }: Readonly<{ row: Notification; onPress: () => void }>) {
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={onPress} className="gap-2 p-4">
        <View className="flex-row items-center gap-2">
          {row.isRead ? null : <View className="size-2 rounded-full bg-primary" />}
          <Text className="flex-1 text-base font-semibold text-foreground">{row.title}</Text>
          <Badge variant={row.isRead ? 'neutral' : 'primary'}>{notificationKindOf(row.type)}</Badge>
        </View>
        {row.body ? <Text variant="body">{row.body}</Text> : null}
        <Text variant="meta">{instituteDateTimeLabel(row.createdAt)}</Text>
      </Pressable>
    </Card>
  );
}
