import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox, MultiCombobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';

/**
 * The exam catalog, searched on the server a page at a time. The code is the label: it is what an
 * enrolment stores, so it is what an admin recognises a row by. A stage is qualified by its
 * exam's code, because "Tier 1" alone names half a dozen different papers.
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

/** A CHOOSER: only active exams, because a retired one is not something to file new work under. */
export function ExamPicker(props: Readonly<PickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.EXAMS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) =>
      api.admin.exams.list({ page, pageSize: PAGE_SIZE_MAX, q: search, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'All exams'}
      items={pages.items.map((exam) => ({
        value: exam.id,
        label: exam.code,
        hint: exam.name,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search exams"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No exam matches that"
    />
  );
}

/** What a chosen stage is called, for a caller that has to name something after it. */
export interface StageChoice {
  examCode: string;
  stageName: string;
}

/** Only active stages: a retired one takes no new config, and the save would be refused. */
export function ExamStagePicker({
  examId,
  onChange,
  onPick,
  ...props
}: Readonly<PickerProps & { examId?: string; onPick?: (chosen: StageChoice | null) => void }>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.EXAM_STAGES, QUERY_SCOPES.PICKER, examId ?? '', search],
    fetchPage: (page) =>
      api.admin.examStages.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        examId: examId || undefined,
        activeOnly: 'true',
      }),
  });

  return (
    <Combobox
      {...props}
      placeholder={props.placeholder ?? 'All stages'}
      items={pages.items.map((stage) => ({
        value: stage.id,
        label: `${stage.exam.code} / ${stage.name}`,
        hint: stage.stageKey,
      }))}
      onChange={(value) => {
        const stage = pages.items.find((candidate) => candidate.id === value);
        onPick?.(stage ? { examCode: stage.exam.code, stageName: stage.name } : null);
        onChange(value);
      }}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search stages"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No stage matches that"
    />
  );
}

/** The same two lists, choosing several. A filter narrows to a set; a form still picks one. */
interface MultiPickerProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  selectedLabels?: Readonly<Record<string, string>>;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}

/** A FILTER, so it reaches retired exams — tests and configurations are still filed under them. */
export function ExamMultiPicker(props: Readonly<MultiPickerProps>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.EXAMS, QUERY_SCOPES.FILTER, search],
    fetchPage: (page) => api.admin.exams.list({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <MultiCombobox
      {...props}
      chips={false}
      placeholder={props.placeholder ?? 'All exams'}
      items={pages.items.map((exam) => ({ value: exam.id, label: exam.code, hint: exam.name }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search exams"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No exam matches that"
    />
  );
}

export function ExamStageMultiPicker({
  examIds,
  ...props
}: Readonly<MultiPickerProps & { examIds: readonly string[] }>) {
  const [search, setSearch] = useState('');
  const scope = [...examIds].join(',');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.EXAM_STAGES, QUERY_SCOPES.PICKER, scope, search],
    fetchPage: (page) =>
      api.admin.examStages.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        examId: [...examIds],
        activeOnly: 'true',
      }),
  });

  return (
    <MultiCombobox
      {...props}
      chips={false}
      placeholder={props.placeholder ?? 'All stages'}
      items={pages.items.map((stage) => ({
        value: stage.id,
        label: `${stage.exam.code} / ${stage.name}`,
        hint: stage.stageKey,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search stages"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No stage matches that"
    />
  );
}
