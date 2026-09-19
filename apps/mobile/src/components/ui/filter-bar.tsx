/**
 * The web's filter bar, folded all the way: every filter lives in one sheet, opened from the
 * control in the screen's header, and what is set reads back as a line under the title. Same spec,
 * same counts and the same Clear — a phone has no room for a row of comboboxes.
 */
/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnstableNativeVariable } from 'nativewind';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import { Text } from './text';
import { asSet, asText, summaryOf, type FilterSpec, type FilterState } from '../../lib/filters';
import { useTokenColor } from '../../lib/use-token-color';
import { Button } from './button';
import { Chip, ChipRow } from './chip-row';

export interface FilterProps {
  state: FilterState;
  filters: readonly FilterSpec[];
}

/** One tap to every filter, with what is set counted on it. */
export function FilterTrigger({
  state,
  filters,
  bare = false,
}: Readonly<FilterProps & { bare?: boolean }>) {
  const [open, setOpen] = useState(false);
  const glyph = useTokenColor('--foreground');
  const chosen = filters.filter((filter) => filter.kind !== 'search');

  if (chosen.length === 0) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state.activeCount > 0 ? `Filters, ${state.activeCount} set` : 'Filters'}
        onPress={() => setOpen(true)}
        // A native header draws its own round button behind this one; a page draws nothing.
        className={`h-11 w-11 items-center justify-center rounded-full ${bare ? '' : 'border border-border bg-surface'}`}
      >
        <SlidersHorizontal size={18} color={glyph} />
        {state.activeCount > 0 ? (
          <View className="absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1">
            <Text className="text-2xs font-semibold text-primary-foreground">
              {state.activeCount}
            </Text>
          </View>
        ) : null}
      </Pressable>

      <FilterSheet
        open={open}
        filters={chosen}
        state={state}
        onClose={() => setOpen(false)}
        // One filter has nothing to combine with, so choosing IS the whole visit.
        closeOnChoice={chosen.length === 1}
      />
    </>
  );
}

/** What is narrowing the list, in the reader's own words. Absent until something is set. */
export function FilterSummary({ state, filters }: Readonly<FilterProps>) {
  const set = summaryOf(filters, state.values);
  if (set.length === 0) return null;

  return (
    <View className="flex-row items-center gap-3">
      <Text variant="muted" className="flex-1" numberOfLines={1}>
        {set.join(' · ')}
      </Text>
      {/* Shown only when it would do something — a permanently greyed Clear teaches nobody. */}
      <Pressable accessibilityRole="button" onPress={state.clearFilters} className="py-1">
        <Text className="text-sm font-medium text-primary-ink">Clear</Text>
      </Pressable>
    </View>
  );
}

/** A search says what you are looking for rather than narrowing a choice, so it stays on screen. */
export function FilterSearch({ state, filters }: Readonly<FilterProps>) {
  const placeholderColor = useUnstableNativeVariable('--placeholder');
  const search = filters.find((filter) => filter.kind === 'search');
  if (!search) return null;

  return (
    <TextInput
      value={asText(state.values[search.key])}
      onChangeText={(next) => state.setFilter(search.key, next)}
      placeholder={search.placeholder}
      placeholderTextColor={typeof placeholderColor === 'string' ? placeholderColor : undefined}
      accessibilityLabel={search.label}
      className="h-11 rounded-md border border-input bg-surface px-3 text-base text-foreground"
    />
  );
}

function FilterSheet({
  open,
  filters,
  state,
  onClose,
  closeOnChoice,
}: Readonly<FilterProps & { open: boolean; onClose: () => void; closeOnChoice: boolean }>) {
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
            <Text variant="section">Filters</Text>
            <Button variant="ghost" onPress={onClose}>
              Done
            </Button>
          </View>

          <ScrollView className="shrink grow-0" contentContainerClassName="gap-5 px-4 pb-2">
            {filters.map((filter) => (
              <FilterControl
                key={filter.key}
                filter={filter}
                state={state}
                onChosen={closeOnChoice ? onClose : undefined}
              />
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

function FilterControl({
  filter,
  state,
  onChosen,
}: Readonly<{ filter: FilterSpec; state: FilterState; onChosen?: () => void }>) {
  // A search draws itself in the bar, and it is the one kind with no choices to draw.
  const items = filter.items ?? [];

  if (filter.kind === 'multi') {
    const held = asSet(state.values[filter.key]);

    return (
      <View className="gap-1.5">
        <Text variant="metaStrong">{filter.label}</Text>
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
        onChange={(next) => {
          state.setFilter(filter.key, next);
          onChosen?.();
        }}
      />
    );
  }

  return null;
}

/** Choosing nothing already means every one of them, so the last one off is an empty set, not none. */
const toggled = (held: readonly string[], value: string): string[] =>
  held.includes(value) ? held.filter((one) => one !== value) : [...held, value];
