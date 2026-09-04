import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox, MultiCombobox, plural } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';

/** A program is picked by its CODE: a student row and a series both store that string with no FK. */

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

/** Only active events: an event nobody is running is not a roster to build a series on. */
export function EventPicker(props: Readonly<PickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.EVENTS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) =>
      api.admin.events.list({ page, pageSize: PAGE_SIZE_MAX, q: search, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'Any event'}
      items={pages.items.map((event) => ({
        value: event.id,
        label: event.name,
        hint: plural(event.candidateCount, 'candidate'),
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search events"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No event matches that"
    />
  );
}

/** The name comes back with the id because what asks for a series next is a dialog naming it. */
export function TestSeriesPicker({
  notReachedBy,
  onChange,
  ...props
}: Readonly<
  Omit<PickerProps, 'onChange'> & {
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

  const items = pages.items.map((series) => ({
    value: series.id,
    label: series.name,
    hint: series.examStage ? `${series.examStage.examCode} / ${series.examStage.name}` : undefined,
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
  forExamStageId,
  placeholder = 'No series yet',
  ...control
}: Readonly<{
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** The stage of the test being offered: hides series built for a different one. */
  forExamStageId?: string;
  /** A form says what is chosen; a filter says what choosing nothing means. */
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.TEST_SERIES, QUERY_SCOPES.PICKER, search, forExamStageId ?? ''],
    fetchPage: (page) =>
      api.admin.testSeries.list({ page, pageSize: PAGE_SIZE_MAX, q: search, forExamStageId }),
  });

  return (
    <MultiCombobox
      {...control}
      chips={false}
      disabled={disabled}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
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

/** The same catalog as `ProgramPicker`, for a filter choosing several at once. */
export function ProgramMultiPicker({
  value,
  onChange,
  placeholder = 'Any program',
  ...control
}: Readonly<{
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) =>
      api.admin.programs.list({ page, pageSize: PAGE_SIZE_MAX, q: search, activeOnly: 'true' }),
  });

  return (
    <MultiCombobox
      {...control}
      chips={false}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
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

/** A candidate on an event is a student row, so a roster is picked out of the directory itself. */
export function StudentMultiPicker({
  value,
  onChange,
  placeholder = 'No students chosen',
  ...control
}: Readonly<{
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.STUDENTS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) => api.admin.students.list({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <MultiCombobox
      {...control}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      items={pages.items.map((student) => ({
        value: student.id,
        label: student.fullName ?? student.mobile,
        hint: student.mobile,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by name or mobile number"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No student matches that"
    />
  );
}
