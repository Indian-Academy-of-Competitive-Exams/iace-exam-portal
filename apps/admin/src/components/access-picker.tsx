import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';

/**
 * The two catalogs access is built out of, each searched on the server a page at a time.
 * A program is picked by its CODE, not its id: a student row and a series both store that
 * string with no foreign key, so the code is the value everything else already holds.
 */

interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  /** The label of the current value, for when it sits outside the loaded pages. */
  selectedLabel?: string;
  placeholder?: string;
  clearable?: boolean;
  id?: string;
  'aria-label'?: string;
}

/** Only active programs: the server refuses a retired one, so it is never offered. */
export function ProgramPicker(props: Readonly<PickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) =>
      api.admin.programs.list({ page, pageSize: PAGE_SIZE_MAX, q: search, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'Any program'}
      items={pages.items.map((program) => ({
        value: program.code,
        label: program.code,
        hint: program.name,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search programs"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No program matches that"
    />
  );
}

/**
 * The series catalog. `excludeId` drops the one being edited — nothing waits on itself.
 * The name comes back with the id because what asks for a series next is a dialog naming it.
 */
export function TestSeriesPicker({
  excludeId,
  notReachedBy,
  onChange,
  ...props
}: Readonly<
  Omit<PickerProps, 'onChange'> & {
    excludeId?: string;
    /** A student id: the server drops what they already reach, so a grant that does nothing is unofferable. */
    notReachedBy?: string;
    onChange: (value: string, label: string) => void;
  }
>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.TEST_SERIES, QUERY_SCOPES.PICKER, search, notReachedBy ?? ''],
    fetchPage: (page) =>
      api.admin.testSeries.list({ page, pageSize: PAGE_SIZE_MAX, q: search, notReachedBy }),
  });

  const items = pages.items
    .filter((series) => series.id !== excludeId)
    .map((series) => ({
      value: series.id,
      label: series.name,
      hint: series.examStage
        ? `${series.examStage.examCode} / ${series.examStage.name}`
        : undefined,
    }));

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'No series'}
      items={items}
      onChange={(value) => onChange(value, items.find((item) => item.value === value)?.label ?? '')}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search series"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No series matches that"
    />
  );
}

/** The same catalog, choosing several — a test is offered through every series that carries it. */
export function TestSeriesMultiPicker({
  value,
  onChange,
  disabled,
  ...control
}: Readonly<{
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.TEST_SERIES, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) => api.admin.testSeries.list({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <MultiCombobox
      {...control}
      chips={false}
      disabled={disabled}
      value={value}
      onChange={onChange}
      placeholder="No series yet"
      items={pages.items.map((series) => ({
        value: series.id,
        label: series.name,
        hint: series.examStage
          ? `${series.examStage.examCode} / ${series.examStage.name}`
          : undefined,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search series"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No series matches that"
    />
  );
}
