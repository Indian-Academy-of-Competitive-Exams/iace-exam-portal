import * as React from 'react';
import { Combobox, type ComboboxItem } from './combobox';
import {
  DataTable,
  type DataTableColumn,
  type DataTableExpand,
  type DataTableSelection,
} from './data-table';
import { DatePicker } from './date-picker';
import { Field } from './field';
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

/** What `useListScreen` returns, declared here so design does not import from app-kit. */
export interface ListState<TRow> {
  rows: readonly TRow[];
  isLoading: boolean;
  /** Whether a page has ever arrived — the pager stays hidden until one has. */
  hasLoaded: boolean;
  values: Readonly<Record<string, ListFilterValue>>;
  setFilter: (key: string, value: ListFilterValue) => void;
  clearFilters: () => void;
  /** Absent for a list that loads in full. */
  pagination?: PaginationProps;
}

export interface ListViewProps<TRow> {
  list: ListState<TRow>;
  /** Omit for a list nobody filters. */
  filters?: readonly ListFilter[];
  columns: readonly DataTableColumn<TRow>[];
  rowKey: (row: TRow) => string;
  empty: React.ReactNode;
  /** Shown instead of `empty` when a filter is set — "none match" sends the reader elsewhere. */
  emptyFiltered?: React.ReactNode;
  /** Above the filters: what this list is pinned to, when a link arrived carrying it. */
  banner?: React.ReactNode;
  skeletonRows?: number;
  selection?: DataTableSelection;
  expand?: DataTableExpand<TRow>;
}

const isSet = (value: ListFilterValue | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : (value ?? '') !== '';

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

/** One list — filters, rows, pager. A screen holds one of these, or one per tab. */
export function ListView<TRow>({
  list,
  filters,
  columns,
  rowKey,
  empty,
  emptyFiltered,
  banner,
  skeletonRows,
  selection,
  expand,
}: Readonly<ListViewProps<TRow>>) {
  const fills = useInTableFrame();
  const spec = filters ?? [];
  const primary = spec.filter((filter) => filter.primary);
  const folded = spec.filter((filter) => !filter.primary);

  const bind = (filter: ListFilter) => ({
    value: list.values[filter.key],
    onChange: (next: ListFilterValue) => list.setFilter(filter.key, next),
  });

  const countSet = (subset: readonly ListFilter[]) =>
    subset.filter((filter) => isSet(list.values[filter.key])).length;
  const activeCount = countSet(spec);

  const bar =
    spec.length > 0 ? (
      <FilterBar
        activeCount={activeCount}
        advancedCount={countSet(folded)}
        onClear={list.clearFilters}
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
          <div key={filter.key} className={filter.width ?? widthOf(filter)}>
            <FilterControl
              filter={filter}
              naming={{ 'aria-label': filter.label }}
              {...bind(filter)}
            />
          </div>
        ))}
      </FilterBar>
    ) : null;

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
      empty={activeCount > 0 && emptyFiltered ? emptyFiltered : empty}
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
