/// <reference types="nativewind/types" />
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useInfinitePages } from '@iace/app-kit';
import {
  instituteDayLabel,
  SAVED_QUESTION_KIND,
  type SavedFacets,
  type SavedQuestion,
  type SavedQuestionKind,
} from '@iace/contracts';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import { api } from '../../lib/api';
import { savedFacetsQueryKey, savedQueryKey } from '../../lib/constants';
import { asText, useFilterState, type Filter, type FilterOption } from '../../lib/filters';
import { useTokenColor } from '../../lib/use-token-color';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { FilterBar } from '../ui/filter-bar';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { SavedQuestionSheet } from './saved-question-sheet';

const ANY = '';

/** The keys this list filters on, named once so the spec and the query cannot drift. */
const KEYS = { SUBJECT: 'subjectId', TEST: 'testId' } as const;

/** What each list is for, said once at the top rather than on every row. */
const KIND_NOTE: Readonly<Record<SavedQuestionKind, string>> = {
  [SAVED_QUESTION_KIND.BOOKMARK]: 'Starred from a solution review, and yours to drop.',
  [SAVED_QUESTION_KIND.MISTAKE]:
    'Added when a marked answer was wrong. Clearing one brings it back only if you miss it again.',
};

export function SavedList({ kind }: Readonly<{ kind: SavedQuestionKind }>) {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<SavedQuestion | null>(null);
  const [dropping, setDropping] = useState<SavedQuestion | null>(null);
  const spinner = useTokenColor('--muted-foreground');

  const facets = useQuery({
    queryKey: savedFacetsQueryKey(kind),
    queryFn: () => api.me.savedFacets({ kind }),
  });

  const filters = useMemo(() => filterSpec(facets.data), [facets.data]);
  const state = useFilterState(filters);
  const subjectId = asText(state.values[KEYS.SUBJECT]);
  const testId = asText(state.values[KEYS.TEST]);

  const list = useInfinitePages({
    queryKey: [...savedQueryKey(kind), { subjectId, testId }],
    fetchPage: (page) =>
      api.me.savedQuestions({
        kind,
        page,
        subjectId: subjectId === ANY ? undefined : subjectId,
        testId: testId === ANY ? undefined : testId,
      }),
  });

  const drop = useMutation({
    mutationFn: (id: string) => api.me.removeSavedQuestion(id),
    onSettled: () => {
      setDropping(null);
      void queryClient.invalidateQueries({ queryKey: savedQueryKey(kind) });
      void queryClient.invalidateQueries({ queryKey: savedFacetsQueryKey(kind) });
    },
  });

  const filtered = state.activeCount > 0;

  return (
    <>
      <FlatList
        className="flex-1 bg-background"
        contentContainerStyle={CONTENT_STYLE}
        data={list.items}
        keyExtractor={(row) => row.id}
        onEndReachedThreshold={0.5}
        onEndReached={list.loadMore}
        renderItem={({ item }) => (
          <SavedRow row={item} onRead={() => setReading(item)} onDrop={() => setDropping(item)} />
        )}
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            <Alert variant="info">{KIND_NOTE[kind]}</Alert>
            <FilterBar state={state} filters={filters} />
          </View>
        }
        ListEmptyComponent={<ListBody kind={kind} list={list} filtered={filtered} />}
        ListFooterComponent={
          list.isLoadingMore ? <ActivityIndicator className="py-4" color={spinner} /> : null
        }
      />

      {reading ? <SavedQuestionSheet saved={reading} onClose={() => setReading(null)} /> : null}

      <ConfirmDialog
        open={dropping !== null}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Remove this question?"
        description={removalOf(kind)}
        confirmLabel="Remove"
        loading={drop.isPending}
        onConfirm={() => {
          if (dropping) drop.mutate(dropping.id);
        }}
        onCancel={() => setDropping(null)}
      />
    </>
  );
}

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40, gap: 12 };

function ListBody({
  kind,
  list,
  filtered,
}: Readonly<{
  kind: SavedQuestionKind;
  list: { isLoading: boolean; isError: boolean; retry: () => void };
  filtered: boolean;
}>) {
  if (list.isLoading) {
    return (
      <View className="gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </View>
    );
  }
  if (list.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your saved questions did not load"
        onRetry={list.retry}
      />
    );
  }
  if (filtered) {
    return <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />;
  }
  return kind === SAVED_QUESTION_KIND.BOOKMARK ? (
    <EmptyState title="No bookmarks yet" />
  ) : (
    // A mistake list with nothing on it is a good outcome, which the kind's own glyph would deny.
    <EmptyState title="No mistakes recorded" icon={CircleCheck} />
  );
}

function SavedRow({
  row,
  onRead,
  onDrop,
}: Readonly<{ row: SavedQuestion; onRead: () => void; onDrop: () => void }>) {
  return (
    <Card className="gap-3 p-4">
      <Pressable accessibilityRole="button" onPress={onRead} className="gap-2">
        <Text className="text-base text-foreground" numberOfLines={3}>
          {row.stemPreview}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge variant="neutral">{row.subject}</Badge>
          {row.topic ? <Text className="text-xs text-muted-foreground">{row.topic}</Text> : null}
        </View>
      </Pressable>

      <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
        <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
          {footOf(row)}
        </Text>
        <Pressable accessibilityRole="button" onPress={onDrop} className="px-1 py-1">
          <Text className="text-xs font-medium text-destructive">Remove</Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** Where it came from and when it was kept — the two facts a revision list is sorted through. */
function footOf(row: SavedQuestion): string {
  const parts = [row.testTitle, instituteDayLabel(row.createdAt)];
  if (row.timeSpentSec !== null) parts.push(`${row.timeSpentSec}s`);
  return parts.filter((part) => Boolean(part)).join(' · ');
}

const removalOf = (kind: SavedQuestionKind) =>
  kind === SAVED_QUESTION_KIND.BOOKMARK
    ? 'It leaves your bookmarks. Star it again from the solution review to bring it back.'
    : 'It leaves your mistakes. It comes back only if you get it wrong again.';

/** Both fold: a subject list and a paper list are longer than a phone's width either way. */
function filterSpec(facets: SavedFacets | undefined): Filter[] {
  return [
    {
      key: KEYS.SUBJECT,
      kind: 'choice',
      label: 'Subject',
      items: facetOptions(facets?.subjects, 'Any subject'),
    },
    {
      key: KEYS.TEST,
      kind: 'choice',
      label: 'Test',
      items: facetOptions(facets?.tests, 'Any test'),
    },
  ];
}

/** Only what their own set spans: a filter must offer no choice that finds nothing. */
const facetOptions = (rows: SavedFacets['subjects'] | undefined, any: string): FilterOption[] => [
  { value: ANY, label: any },
  ...(rows ?? []).map((row) => ({ value: row.id, label: row.name })),
];
