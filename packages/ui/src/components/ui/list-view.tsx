import * as React from 'react';
import { Combobox, type ComboboxItem } from './combobox';
import {
  DataTable,
  type DataTableColumn,
  type DataTableExpand,
  type DataTableScroll,
  type DataTableSelection,
} from './data-table';
import { DatePicker } from './date-picker';
import { EMPTY_STATE_KINDS, type EmptyMessage } from './empty-state';
import { Field } from './field';
import { NotchedField } from './notched-field';
import { FilterBar } from './filter-bar';
import { MultiCombobox } from './multi-combobox';
import { Pagination, type PaginationProps } from './pagination';
import { SearchInput } from './search-input';
import { useInTableFrame } from './table-frame';

/** A set for a `multi` filter, a string for every other kind. */
export type ListFilterValue = string | readonly string[];

/** What names a control, whichever kind it is. The value and its setter differ by kind. */
export interface ListFilterLabelling {
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface ListFilterControl extends ListFilterLabelling {
  value: string;
  onChange: (next: string) => void;
}

/** The same, for a control choosing several. It never sees the wire format — that is the hook's. */
export interface ListFilterMultiControl extends ListFilterLabelling {
  value: readonly string[];
  onChange: (next: string[]) => void;
}

interface ListFilterBase<K extends string> {
  key: K;
  /** Names the control: its `aria-label` on screen, its `Field` label behind the fold. */
  label: string;
  /** On screen beside the search box. Everything else folds behind "Filters". */
  primary?: boolean;
  /** Overrides the width a primary control gets from its kind. */
  width?: string;
  /** True keeps it narrowing whichever way "match all / any" is set — a sort, or a date range. */
  alwaysApplies?: boolean;
}

/** The controls a filter can be. A fifth kind is a change here, not a slot at a call site. */
export type ListFilter<K extends string = string> =
  | (ListFilterBase<K> & { kind: 'search'; placeholder?: string })
  /** `items` carries its own "Any …" row, so the control is never also clearable. */
  | (ListFilterBase<K> & { kind: 'choice'; items: readonly ComboboxItem[] })
  /** Several at once. No "Any …" row: choosing nothing already means every one of them. */
  | (ListFilterBase<K> & { kind: 'multi'; items: readonly ComboboxItem[]; placeholder?: string })
  | (ListFilterBase<K> & { kind: 'date'; min?: string; max?: string })
  /** A list too long to hand over as `items` — a server-searched, paged picker draws itself. */
  | (ListFilterBase<K> & {
      kind: 'custom';
      render: (control: ListFilterControl) => React.ReactNode;
    })
  /** The same list, choosing several of it. */
  | (ListFilterBase<K> & {
      kind: 'customMulti';
      render: (control: ListFilterMultiControl) => React.ReactNode;
    });

/** The half of a list's state that is only about its filters. A panel has this and no rows. */
export interface FilterState {
  values: Readonly<Record<string, ListFilterValue>>;
  setFilter: (key: string, value: ListFilterValue) => void;
  clearFilters: () => void;
  /** Both present offers the reader the choice; omit them and the filters narrow, as always. */
  matchAny?: boolean;
  setMatchAny?: (matchAny: boolean) => void;
}

export interface ListState<TRow> extends FilterState {
  rows: readonly TRow[];
  isLoading: boolean;
  /** Whether a page has ever arrived — the pager stays hidden until one has. */
  hasLoaded: boolean;
  /** A page that did not arrive. Without it a failed list says there is nothing to list. */
  isError?: boolean;
  retry?: () => void;
  /** Absent for a list that loads in full. */
  pagination?: PaginationProps;
  /** The other way a long list ends: it scrolls and pages itself, so there is no pager. */
  scroll?: DataTableScroll;
}

export interface ListViewProps<TRow> {
  list: ListState<TRow>;
  /** Omit for a list nobody filters. */
  filters?: readonly ListFilter[];
  columns: readonly DataTableColumn<TRow>[];
  rowKey: (row: TRow) => string;
  empty: EmptyMessage;
  /** Shown instead of `empty` when a filter is set — "none match" sends the reader elsewhere. */
  emptyFiltered?: EmptyMessage;
  /** Shown instead of either when the page did not load. Defaults to a retry. */
  error?: EmptyMessage;
  /** Above the filters: what this list is pinned to, when a link arrived carrying it. */
  banner?: React.ReactNode;
  /** First in the filter row: a mandatory scope the list is read through, never one of its filters. */
  leading?: React.ReactNode;
  skeletonRows?: number;
  selection?: DataTableSelection;
  expand?: DataTableExpand<TRow>;
}

const isSet = (value: ListFilterValue | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : (value ?? '') !== '';

/** How many of a spec are set. Read by the bar for its badge and by the list for its empty state. */
export function activeFilterCount(
  values: FilterState['values'],
  filters: readonly ListFilter[],
): number {
  return filters.filter((filter) => isSet(values[filter.key])).length;
}

const asText = (value: ListFilterValue | undefined): string =>
  typeof value === 'string' ? value : '';

const asSet = (value: ListFilterValue | undefined): readonly string[] =>
  Array.isArray(value) ? value : [];

/** The kinds whose value is a set. Exported so the hook encoding it cannot list a different pair. */
export const SET_KINDS = ['multi', 'customMulti'] as const;
export type SetKind = (typeof SET_KINDS)[number];

/** Widened for the lookup: the tuple above stays literal because `SetKind` is derived from it. */
const SET_KIND_NAMES: readonly string[] = SET_KINDS;

export const holdsASet = (filter: ListFilter): boolean => SET_KIND_NAMES.includes(filter.kind);

/** A search says what you are looking for and a date range scopes it; neither is a choice to combine. */
const ALWAYS_NARROWS = (filter: ListFilter): boolean =>
  filter.kind === 'search' || filter.kind === 'date' || filter.alwaysApplies === true;

const widthOf = (filter: ListFilter): string => {
  if (filter.kind === 'search') return 'min-w-56 flex-1';
  return holdsASet(filter) ? 'w-56' : 'w-44';
};

/** Behind the fold a `Field` names the control, so a second name on it would be one too many. */
function FilterControl({
  filter,
  naming,
  value,
  onChange,
}: Readonly<{
  filter: ListFilter;
  naming: ListFilterLabelling;
  value: ListFilterValue | undefined;
  onChange: (next: ListFilterValue) => void;
}>) {
  if (filter.kind === 'customMulti') {
    return filter.render({ ...naming, value: asSet(value), onChange });
  }

  if (filter.kind === 'multi') {
    return (
      <MultiCombobox
        {...naming}
        chips={false}
        items={filter.items}
        placeholder={filter.placeholder}
        value={asSet(value)}
        onChange={onChange}
      />
    );
  }

  const control: ListFilterControl = { ...naming, value: asText(value), onChange };

  if (filter.kind === 'custom') return filter.render(control);

  if (filter.kind === 'search') {
    return (
      <SearchInput
        id={naming.id}
        aria-label={filter.label}
        placeholder={filter.placeholder}
        value={control.value}
        onChange={control.onChange}
      />
    );
  }

  if (filter.kind === 'date') {
    return <DatePicker {...control} min={filter.min} max={filter.max} />;
  }

  return <Combobox {...control} clearable={false} items={filter.items} />;
}

/** A spec as a bar: primary controls inline, the rest folded, and what Clear drops. */
export function FilterRow({
  state,
  filters,
  leading,
}: Readonly<{
  state: FilterState;
  filters: readonly ListFilter[];
  leading?: React.ReactNode;
}>) {
  const primary = filters.filter((filter) => filter.primary);
  const folded = filters.filter((filter) => !filter.primary);

  const bind = (filter: ListFilter) => ({
    value: state.values[filter.key],
    onChange: (next: ListFilterValue) => state.setFilter(filter.key, next),
  });

  // With fewer than two to combine, "all" and "any" ask the same question and the choice is noise.
  const combinable = filters.filter((filter) => !ALWAYS_NARROWS(filter)).length;
  const offersMatch = Boolean(state.setMatchAny) && combinable > 1;

  return (
    <FilterBar
      leading={leading}
      activeCount={activeFilterCount(state.values, filters)}
      advancedCount={activeFilterCount(state.values, folded)}
      onClear={state.clearFilters}
      matchAny={state.matchAny}
      onMatchAnyChange={offersMatch ? state.setMatchAny : undefined}
      advanced={
        folded.length > 0
          ? folded.map((filter) => (
              <Field key={filter.key} htmlFor={`filter-${filter.key}`} label={filter.label}>
                {(described) => (
                  <FilterControl filter={filter} naming={described} {...bind(filter)} />
                )}
              </Field>
            ))
          : undefined
      }
    >
      {primary.map((filter) => (
        <NotchedField
          key={filter.key}
          className={filter.width ?? widthOf(filter)}
          htmlFor={`filter-${filter.key}`}
          label={filter.label}
        >
          {({ id }) => <FilterControl filter={filter} naming={{ id }} {...bind(filter)} />}
        </NotchedField>
      ))}
    </FilterBar>
  );
}

/** One list — filters, rows, pager. A screen holds one of these, or one per tab. */
export function ListView<TRow>({
  list,
  filters,
  columns,
  rowKey,
  empty,
  emptyFiltered,
  error,
  banner,
  leading,
  skeletonRows,
  selection,
  expand,
}: Readonly<ListViewProps<TRow>>) {
  const fills = useInTableFrame();
  const spec = filters ?? [];
  const activeCount = activeFilterCount(list.values, spec);
  const bar =
    spec.length > 0 || leading ? <FilterRow state={list} filters={spec} leading={leading} /> : null;

  const narrowed = activeCount > 0 && emptyFiltered !== undefined;
  const message = narrowed ? emptyFiltered : empty;

  const head =
    banner || bar ? (
      <div className="shrink-0">
        {banner}
        {bar}
      </div>
    ) : null;

  const table = (
    <DataTable
      columns={columns}
      rows={list.rows}
      rowKey={rowKey}
      isLoading={list.isLoading}
      skeletonRows={skeletonRows}
      selection={selection}
      expand={expand}
      scroll={list.scroll}
      isError={list.isError}
      error={error}
      onRetry={list.retry}
      empty={message}
      emptyKind={narrowed ? EMPTY_STATE_KINDS.FILTERED : EMPTY_STATE_KINDS.EMPTY}
      footer={list.hasLoaded && list.pagination ? <Pagination {...list.pagination} /> : null}
    />
  );

  return fills ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {head}
      {table}
    </div>
  ) : (
    <>
      {head}
      {table}
    </>
  );
}
