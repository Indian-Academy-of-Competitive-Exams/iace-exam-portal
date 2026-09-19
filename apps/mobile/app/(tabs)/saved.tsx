/// <reference types="nativewind/types" />
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { savedFilters } from '@iace/app-kit';
import {
  SAVED_QUESTION_KIND,
  SAVED_QUESTION_KIND_LABELS,
  SAVED_QUESTION_KINDS,
  type SavedQuestionKind,
} from '@iace/contracts';
import { Text } from '../../src/components/ui/text';
import { ChipRow, type ChipOption } from '../../src/components/ui/chip-row';
import { FilterSummary, FilterTrigger } from '../../src/components/ui/filter-bar';
import { SavedList } from '../../src/components/saved/saved-list';
import { api } from '../../src/lib/api';
import { savedFacetsQueryKey } from '../../src/lib/constants';
import { useFilterState } from '../../src/lib/filters';

const KINDS: readonly ChipOption[] = SAVED_QUESTION_KINDS.map((kind) => ({
  value: kind,
  label: SAVED_QUESTION_KIND_LABELS[kind],
}));

/** The two lists a student keeps of the bank: what they starred, and what they got wrong. */
export default function SavedScreen() {
  const [kind, setKind] = useState<SavedQuestionKind>(SAVED_QUESTION_KIND.BOOKMARK);

  const facets = useQuery({
    queryKey: savedFacetsQueryKey(kind),
    queryFn: () => api.me.savedFacets({ kind }),
  });
  const filters = useMemo(() => savedFilters(facets.data), [facets.data]);
  const state = useFilterState(filters);

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-5 pt-6">
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="title" className="flex-1">
            Saved questions
          </Text>
          <FilterTrigger state={state} filters={filters} />
        </View>

        <ChipRow
          options={KINDS}
          value={kind}
          onChange={(next) => {
            setKind(asKind(next));
            // Each list spans its own subjects, so the other's choice would filter this to nothing.
            state.clearFilters();
          }}
        />
        <FilterSummary state={state} filters={filters} />
      </View>

      <SavedList key={kind} kind={kind} state={state} />
    </View>
  );
}

const asKind = (value: string): SavedQuestionKind =>
  (SAVED_QUESTION_KINDS as readonly string[]).includes(value)
    ? (value as SavedQuestionKind)
    : SAVED_QUESTION_KIND.BOOKMARK;
