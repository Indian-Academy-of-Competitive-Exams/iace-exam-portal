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
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
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

/** What the dialog that grants a series has to say about it before the row is written. */
export interface ChosenSeries {
  id: string;
  name: string;
  /** A grant onto a switched-off series opens nothing yet, which only the dialog can say. */
  isEnabled: boolean;
}

/** What a cleared series picker hands back, so nothing has to spell out the empty shape twice. */
export const NO_SERIES: ChosenSeries = {
  id: '',
  name: '',
  isEnabled: false,
};

/** The row comes back with the id because what asks for a series next is a dialog naming it. */
export function TestSeriesPicker({
  notReachedBy,
  forExamStageId,
  onChange,
  ...props
}: Readonly<
  Omit<PickerProps, 'onChange'> & {
    /** A student id: the server drops what they already reach, so a grant that does nothing is unofferable. */
    notReachedBy?: string;
    /** The stage of the test being offered: hides series built for a different one. */
    forExamStageId?: string;
    onChange: (chosen: ChosenSeries) => void;
  }
>) {
  const [search, setSearch] = useState('');
  // Empty is a stage ASKED for and not yet picked, which the server would read as no filter at all.
  const awaitingStage = forExamStageId === '';

  const pages = useInfinitePages({
    queryKey: [
      ...QUERY_KEYS.TEST_SERIES,
      QUERY_SCOPES.PICKER,
      search,
      notReachedBy ?? '',
      forExamStageId ?? '',
    ],
    fetchPage: (page) =>
      api.admin.testSeries.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        notReachedBy,
        forExamStageId,
      }),
    enabled: !awaitingStage,
  });

  const items = pages.items.map((series) => ({
    value: series.id,
    label: series.name,
    hint: series.examStage ? `${series.examStage.examCode} / ${series.examStage.name}` : undefined,
  }));

  const chosenOf = (value: string): ChosenSeries => {
    const row = pages.items.find((series) => series.id === value);
    if (!row) return NO_SERIES;
    return { id: row.id, name: row.name, isEnabled: row.isEnabled };
  };

  return (
    <Combobox
      {...props}
      disabled={awaitingStage || props.disabled}
      placeholder={awaitingStage ? 'Choose a stage first' : (props.placeholder ?? 'No series')}
      items={items}
      onChange={(value) => onChange(chosenOf(value))}
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

/** A FILTER, so unlike `ProgramPicker` it reaches retired programs — students are still on them. */
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
    queryKey: [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.FILTER, search],
    fetchPage: (page) => api.admin.programs.list({ page, pageSize: PAGE_SIZE_MAX, q: search }),
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

/** Which events a roster is being read through — the events themselves, not their candidates. */
export function EventMultiPicker({
  value,
  onChange,
  placeholder = 'Any event',
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
    queryKey: [...QUERY_KEYS.EVENTS, QUERY_SCOPES.FILTER, search],
    fetchPage: (page) => api.admin.events.list({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <MultiCombobox
      {...control}
      chips={false}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      items={pages.items.map((event) => ({ value: event.id, label: event.name }))}
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
