/// <reference types="nativewind/types" />
import { useMemo } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { savedFilters } from '@iace/app-kit';
import { Text } from '../../src/components/ui/text';
import { FilterSummary, FilterTrigger } from '../../src/components/ui/filter-bar';
import { SavedList } from '../../src/components/saved/saved-list';
import { api } from '../../src/lib/api';
import { savedFacetsQueryKey } from '../../src/lib/constants';
import { useFilterState } from '../../src/lib/filters';

/** The questions a student starred in a solution review, theirs to revise and to drop. */
export default function SavedScreen() {
  const facets = useQuery({
    queryKey: savedFacetsQueryKey(),
    queryFn: () => api.me.savedFacets(),
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

        <FilterSummary state={state} filters={filters} />
      </View>

      <SavedList state={state} />
    </View>
  );
}
