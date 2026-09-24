/**
 * The questions a student starred in a solution review. A LIST screen rather than the feed the rest
 * of this portal uses — this one is long, filtered and paged, which is the one job `TableFrame` and
 * `ListView` already do.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenText, Trash2 } from 'lucide-react';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import { SAVED_FILTER_FIELDS } from '@iace/app-kit';
import {
  Alert,
  Badge,
  DropdownMenuItem,
  ListView,
  MultiCombobox,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  cn,
  linkVariants,
  type DataTableColumn,
  type ListFilter,
  type ListFilterMultiControl,
} from '@iace/ui';
import { instituteDayLabel, type SavedQuestion } from '@iace/contracts';
import { api } from '../lib/api';
import { SavedQuestionDialog } from '../components/review/saved-question-dialog';
import { NAV_ITEMS, savedFacetsQueryKey, savedQueryKey } from '../lib/constants';

/** What the list is for, said once at the top rather than on every row. */
const LIST_NOTE = 'Starred from a solution review, and yours to drop.';

export function SavedPage() {
  return (
    <TableFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Saved questions" />}
    >
      <SavedList />
    </TableFrame>
  );
}

/** Only what their own set spans: a filter must offer no choice that finds nothing. */
function FacetPicker({
  facet,
  placeholder,
  control,
}: Readonly<{
  facet: 'subjects' | 'tests';
  placeholder: string;
  control: ListFilterMultiControl;
}>) {
  const facets = useQuery({
    queryKey: savedFacetsQueryKey(),
    queryFn: () => api.me.savedFacets(),
  });

  return (
    <MultiCombobox
      {...control}
      chips={false}
      placeholder={placeholder}
      emptyLabel="Nothing matches that"
      items={(facets.data?.[facet] ?? []).map((row) => ({ value: row.id, label: row.name }))}
    />
  );
}

function SavedList() {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<SavedQuestion | null>(null);

  const drop = useMutation({
    meta: { success: 'Removed from your list.' },
    mutationFn: (id: string) => api.me.removeSavedQuestion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedQueryKey() }),
  });

  const filterSpec = [
    {
      key: SAVED_FILTER_FIELDS.SUBJECT.key,
      kind: 'customMulti',
      label: SAVED_FILTER_FIELDS.SUBJECT.label,
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <FacetPicker
          facet="subjects"
          placeholder={SAVED_FILTER_FIELDS.SUBJECT.placeholder}
          control={control}
        />
      ),
    },
    {
      key: SAVED_FILTER_FIELDS.TEST.key,
      kind: 'customMulti',
      label: SAVED_FILTER_FIELDS.TEST.label,
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <FacetPicker
          facet="tests"
          placeholder={SAVED_FILTER_FIELDS.TEST.placeholder}
          control={control}
        />
      ),
    },
  ] as const satisfies readonly ListFilter[];

  const list = useListScreen({
    queryKey: savedQueryKey(),
    filters: filterSpec,
    toQuery: (values) => ({ subjectId: values.subjectId, testId: values.testId }),
    fetchPage: (params) => api.me.savedQuestions(params),
  });

  return (
    <ListView
      list={list}
      filters={filterSpec}
      columns={savedColumns(drop.isPending, (id) => drop.mutate(id), setReading)}
      rowKey={(row) => row.id}
      empty="No saved questions yet"
      emptyFiltered="Nothing matches"
      banner={
        <>
          {/* ui-copy-ok: rule */}
          <Alert variant="info">{LIST_NOTE}</Alert>
          {reading ? (
            <SavedQuestionDialog saved={reading} onClose={() => setReading(null)} />
          ) : null}
        </>
      }
    />
  );
}

function savedColumns(
  busy: boolean,
  onDrop: (id: string) => void,
  onRead: (saved: SavedQuestion) => void,
): DataTableColumn<SavedQuestion>[] {
  return [
    {
      key: 'question',
      header: 'Question',
      className: 'w-full max-w-0',
      // Opens where it is, rather than sending them to a different paper's report to find it.
      cell: (row) => (
        <button
          type="button"
          className={cn(linkVariants(), 'block min-w-0 max-w-full text-left')}
          onClick={() => onRead(row)}
        >
          <TruncatedText>{row.stemPreview}</TruncatedText>
        </button>
      ),
    },
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-56',
      cell: (row) => <TruncatedText>{row.testTitle}</TruncatedText>,
    },
    {
      key: 'time',
      header: 'Your time',
      numeric: true,
      className: 'max-w-32',
      cell: (row) => (
        <TruncatedText>{row.timeSpentSec === null ? null : `${row.timeSpentSec}s`}</TruncatedText>
      ),
    },
    {
      key: 'subject',
      header: 'Subject',
      className: 'max-w-48',
      // `min-w-0 shrink` is what gives the badge a bound for `TruncatedText` to cut against.
      cell: (row) => (
        <Badge variant="neutral" className="min-w-0 shrink">
          <TruncatedText>{row.subject}</TruncatedText>
        </Badge>
      ),
    },
    {
      key: 'topic',
      header: 'Topic',
      className: 'max-w-48',
      cell: (row) => <TruncatedText>{row.topic}</TruncatedText>,
    },
    {
      key: 'saved',
      header: 'Saved',
      className: 'max-w-40',
      cell: (row) => <TruncatedText>{whenItWasSaved(row.createdAt)}</TruncatedText>,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => (
        <RowActions label="Actions for this question">
          <DropdownMenuItem onSelect={() => onRead(row)}>
            <BookOpenText aria-hidden />
            Read it
          </DropdownMenuItem>
          <DropdownMenuItem destructive disabled={busy} onSelect={() => onDrop(row.id)}>
            <Trash2 aria-hidden />
            Remove it
          </DropdownMenuItem>
        </RowActions>
      ),
    },
  ];
}

/** The institute's clock, never the device's — a student in another zone reads the same day. */
function whenItWasSaved(at: string): string {
  return instituteDayLabel(at);
}
