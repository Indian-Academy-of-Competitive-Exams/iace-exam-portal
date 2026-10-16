/// <reference types="nativewind/types" />
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import Plus from 'lucide-react-native/icons/plus';
import { Stack, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SUPPORT_FILTERS, asText, supportQuery, useInfinitePages } from '@iace/app-kit';
import {
  PAGE_SIZE_DEFAULT,
  SUPPORT_CATEGORY_INFO,
  instituteDateTimeLabel,
  type TicketSummary,
  SUPPORT_STATUS_STUDENT_LABEL,
} from '@iace/contracts';
import { Text } from '../../src/components/ui/text';
import { api } from '../../src/lib/api';
import { SUPPORT_LIST_QUERY_KEY, SUPPORT_STATUS_BADGE } from '../../src/lib/constants';
import { ACCOUNT_ROUTES, DETAIL_ROUTES } from '../../src/lib/nav';
import { useFilterState, type FilterState } from '../../src/lib/filters';
import { useRefetchOnFocus } from '../../src/lib/use-refetch-on-focus';
import { useSettled } from '../../src/lib/use-settled';
import { useTokenColor } from '../../src/lib/use-token-color';
import { Badge } from '../../src/components/ui/badge';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { EmptyState } from '../../src/components/ui/empty-state';
import { FilterSearch, FilterSummary, FilterTrigger } from '../../src/components/ui/filter-bar';
import { EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state-kinds';
import { ListFooter } from '../../src/components/ui/list-footer';
import { Skeleton } from '../../src/components/ui/skeleton';

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 12 };

/** Their own queries, open first, then latest reply. */
export default function HelpScreen() {
  useRefetchOnFocus();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tint = useTokenColor('--muted-foreground');
  const [pulling, setPulling] = useState(false);
  const state = useFilterState(SUPPORT_FILTERS);
  const search = useSettled(asText(state.values.q));
  const query = supportQuery({ ...state.values, q: search });

  const list = useInfinitePages({
    queryKey: [...SUPPORT_LIST_QUERY_KEY, query],
    fetchPage: (page) => api.me.support.list({ ...query, page, pageSize: PAGE_SIZE_DEFAULT }),
  });

  const pull = () => {
    setPulling(true);
    void queryClient
      .refetchQueries({ queryKey: SUPPORT_LIST_QUERY_KEY })
      .finally(() => setPulling(false));
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: headerActions(state, () => router.navigate(ACCOUNT_ROUTES.HELP_NEW)),
        }}
      />
      <FlatList
        className="flex-1 bg-background"
        contentContainerStyle={CONTENT_STYLE}
        data={list.items}
        keyExtractor={(row) => row.id}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={pull}
            tintColor={tint}
            colors={tint ? [tint] : undefined}
          />
        }
        onEndReachedThreshold={0.5}
        // A failed page is asked for again by the footer's Retry: its changing height would have the scroll ask in a loop.
        onEndReached={list.isLoadMoreError ? undefined : list.loadMore}
        renderItem={({ item }) => (
          <Row row={item} onPress={() => router.navigate(DETAIL_ROUTES.HELP_QUERY(item.id))} />
        )}
        ListHeaderComponent={
          <View className="gap-3">
            <FilterSearch state={state} filters={SUPPORT_FILTERS} />
            <FilterSummary state={state} filters={SUPPORT_FILTERS} />
          </View>
        }
        ListEmptyComponent={<ListBody list={list} filtered={state.activeCount > 0} />}
        ListFooterComponent={<ListFooter list={list} />}
      />
    </>
  );
}

/** A header action is a render function the navigator calls, so it is built outside the screen. */
const headerActions = (state: FilterState, onNew: () => void) => () => (
  <View className="flex-row items-center gap-2">
    <FilterTrigger bare state={state} filters={SUPPORT_FILTERS} />
    <Button variant="ghost" size="sm" icon={Plus} onPress={onNew}>
      New query
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
        title="Could not load your queries"
        onRetry={list.retry}
      />
    );
  }
  return filtered ? (
    <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="No query matches" />
  ) : (
    <EmptyState title="No queries" />
  );
}

function Row({ row, onPress }: Readonly<{ row: TicketSummary; onPress: () => void }>) {
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={onPress} className="gap-2 p-4">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-base font-semibold text-foreground">
            {row.title ?? SUPPORT_CATEGORY_INFO[row.category].label}
          </Text>
          <Badge variant={SUPPORT_STATUS_BADGE[row.status]}>
            {SUPPORT_STATUS_STUDENT_LABEL[row.status]}
          </Badge>
        </View>
        <Text variant="meta">
          {SUPPORT_CATEGORY_INFO[row.category].label} · {instituteDateTimeLabel(row.lastMessageAt)}
        </Text>
      </Pressable>
    </Card>
  );
}
