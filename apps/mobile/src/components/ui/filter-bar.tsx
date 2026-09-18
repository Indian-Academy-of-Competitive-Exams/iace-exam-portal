/**
 * A spec as a bar: the search inline, the primary filters as chips under it, and the rest folded
 * into a sheet — the web folds them behind a button, and a phone has room for nothing else.
 * Clear appears only when it would do something; a permanently greyed one teaches nobody.
 */
/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnstableNativeVariable } from 'nativewind';
import {
  activeFilterCount,
  asSet,
  asText,
  type FilterSpec,
  type FilterState,
} from '../../lib/filters';
import { Button } from './button';
import { Chip, ChipRow } from './chip-row';

export interface FilterBarProps {
  state: FilterState;
  filters: readonly FilterSpec[];
}

export function FilterBar({ state, filters }: Readonly<FilterBarProps>) {
  const [open, setOpen] = useState(false);
  const placeholderColor = useUnstableNativeVariable('--placeholder');

  const search = filters.find((filter) => filter.kind === 'search');
  const primary = filters.filter((filter) => filter.kind !== 'search' && filter.primary);
  const folded = filters.filter((filter) => filter.kind !== 'search' && !filter.primary);
  const foldedCount = activeFilterCount(state.values, folded);

  return (
    <View className="gap-3">
      {search ? (
        <TextInput
          value={asText(state.values[search.key])}
          onChangeText={(next) => state.setFilter(search.key, next)}
          placeholder={search.kind === 'search' ? search.placeholder : undefined}
          placeholderTextColor={typeof placeholderColor === 'string' ? placeholderColor : undefined}
          accessibilityLabel={search.label}
          className="h-11 rounded-md border border-input bg-surface px-3 text-base text-foreground"
        />
      ) : null}

      {primary.map((filter) => (
        <FilterControl key={filter.key} filter={filter} state={state} />
      ))}

      {folded.length > 0 || state.activeCount > 0 ? (
        <View className="flex-row items-center gap-2">
          {folded.length > 0 ? (
            <Button variant="outline" size="sm" onPress={() => setOpen(true)}>
              {foldedCount > 0 ? `Filters (${foldedCount})` : 'Filters'}
            </Button>
          ) : null}
          {state.activeCount > 0 ? (
            <Button variant="ghost" size="sm" onPress={state.clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </View>
      ) : null}

      <FilterSheet open={open} filters={folded} state={state} onClose={() => setOpen(false)} />
    </View>
  );
}

/** The fold, as the sheet a phone reads it in. The controls are the same ones the bar draws. */
function FilterSheet({
  open,
  filters,
  state,
  onClose,
}: Readonly<{
  open: boolean;
  filters: readonly FilterSpec[];
  state: FilterState;
  onClose: () => void;
}>) {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-[var(--overlay-bg)]">
        <Pressable accessibilityLabel="Close" className="flex-1" onPress={onClose} />
        <View
          className="max-h-[85%] gap-4 rounded-t-2xl bg-surface pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 24) }}
        >
          <View className="flex-row items-center justify-between px-4">
            <Text className="text-lg font-semibold text-foreground">Filters</Text>
            <Button variant="ghost" onPress={onClose}>
              Done
            </Button>
          </View>

          <ScrollView className="shrink grow-0" contentContainerClassName="gap-4 px-4">
            {filters.map((filter) => (
              <FilterControl key={filter.key} filter={filter} state={state} />
            ))}
          </ScrollView>

          {state.activeCount > 0 ? (
            <View className="px-4">
              <Button variant="outline" onPress={state.clearFilters}>
                {`Clear filters (${state.activeCount})`}
              </Button>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function FilterControl({ filter, state }: Readonly<{ filter: FilterSpec; state: FilterState }>) {
  // A search draws itself in the bar, and only it comes with no choices to draw.
  const items = filter.items ?? [];

  if (filter.kind === 'multi') {
    const held = asSet(state.values[filter.key]);

    return (
      <View className="gap-1.5">
        <Text className="text-xs font-medium text-muted-foreground">{filter.label}</Text>
        <View className="flex-row flex-wrap gap-2">
          {items.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              selected={held.includes(item.value)}
              onPress={() => state.setFilter(filter.key, toggled(held, item.value))}
            />
          ))}
        </View>
      </View>
    );
  }

  if (filter.kind === 'choice') {
    return (
      <ChipRow
        label={filter.label}
        options={items}
        value={asText(state.values[filter.key])}
        onChange={(next) => state.setFilter(filter.key, next)}
      />
    );
  }

  return null;
}

/** Choosing nothing already means every one of them, so removing the last is not an empty set to store. */
const toggled = (held: readonly string[], value: string): string[] =>
  held.includes(value) ? held.filter((one) => one !== value) : [...held, value];
