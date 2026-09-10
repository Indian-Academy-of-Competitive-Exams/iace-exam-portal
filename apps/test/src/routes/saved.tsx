/**
 * The two lists a student keeps of the bank: BOOKMARKS they starred in a review, and MISTAKES the
 * fold wrote for them. A LIST screen rather than the feed the rest of this portal uses — these are
 * long, filtered and paged, which is the one job `TableFrame` and `ListView` already do.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenText, CircleCheck, Trash2 } from 'lucide-react';
import { PageCrumbs, useFilters, useListScreen } from '@iace/app-kit/browser';
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
import {
  INSTITUTE_TIME_ZONE,
  SAVED_QUESTION_KIND,
  SAVED_QUESTION_KINDS,
  SAVED_QUESTION_KIND_LABELS,
  type SavedQuestion,
  type SavedQuestionKind,
} from '@iace/contracts';
import { api } from '../lib/api';
import { SavedQuestionDialog } from '../components/review/saved-question-dialog';
import { NAV_ITEMS, savedFacetsQueryKey, savedQueryKey } from '../lib/constants';

const KIND_KEY = 'list';
const SUBJECT_KEY = 'subjectId';
const TEST_KEY = 'testId';

/** What each list is for, said once at the top rather than on every row. */
const KIND_NOTE: Readonly<Record<SavedQuestionKind, string>> = {
  [SAVED_QUESTION_KIND.BOOKMARK]: 'Starred from a solution review, and yours to drop.',
  [SAVED_QUESTION_KIND.MISTAKE]:
    'Added when a marked answer was wrong. Clearing one brings it back only if you miss it again.',
};

export function SavedPage() {
  const filters = useFilters<typeof KIND_KEY | typeof SUBJECT_KEY | typeof TEST_KEY>();
  const chosen = filters.get(KIND_KEY);
  const kind: SavedQuestionKind = isKind(chosen) ? chosen : SAVED_QUESTION_KIND.BOOKMARK;

  return (
    <TableFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Saved questions" />}
      tabs={{
        value: kind,
        // Each list spans its own subjects, so the other's choice would filter this one to nothing.
        onValueChange: (next) =>
          filters.set({ [KIND_KEY]: next, [SUBJECT_KEY]: '', [TEST_KEY]: '' }),
        items: SAVED_QUESTION_KINDS.map((value) => ({
          value,
          label: SAVED_QUESTION_KIND_LABELS[value],
          content: <SavedList kind={value} />,
        })),
      }}
    />
  );
}

const isKind = (value: string): value is SavedQuestionKind =>
  (SAVED_QUESTION_KINDS as readonly string[]).includes(value);

/** Only what their own set spans: a filter must offer no choice that finds nothing. */
function FacetPicker({
  kind,
  facet,
  placeholder,
  control,
}: Readonly<{
  kind: SavedQuestionKind;
  facet: 'subjects' | 'tests';
  placeholder: string;
  control: ListFilterMultiControl;
}>) {
  const facets = useQuery({
    queryKey: savedFacetsQueryKey(kind),
    queryFn: () => api.me.savedFacets({ kind }),
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

function SavedList({ kind }: Readonly<{ kind: SavedQuestionKind }>) {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<SavedQuestion | null>(null);

  const drop = useMutation({
    meta: { success: 'Removed from your list.' },
    mutationFn: (id: string) => api.me.removeSavedQuestion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedQueryKey(kind) }),
  });

  const filterSpec = [
    {
      key: SUBJECT_KEY,
      kind: 'customMulti',
      label: 'Subject',
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <FacetPicker kind={kind} facet="subjects" placeholder="Any subject" control={control} />
      ),
    },
    {
      key: TEST_KEY,
      kind: 'customMulti',
      label: 'Test',
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <FacetPicker kind={kind} facet="tests" placeholder="Any test" control={control} />
      ),
    },
  ] as const satisfies readonly ListFilter[];

  const list = useListScreen({
    queryKey: savedQueryKey(kind),
    filters: filterSpec,
    toQuery: (values) => ({ kind, subjectId: values.subjectId, testId: values.testId }),
    fetchPage: (params) => api.me.savedQuestions(params),
  });

  return (
    <ListView
      list={list}
      filters={filterSpec}
      columns={savedColumns(drop.isPending, (id) => drop.mutate(id), setReading)}
      rowKey={(row) => row.id}
      empty={emptyFor(kind)}
      emptyFiltered="Nothing matches"
      banner={
        <>
          {/* ui-copy-ok: rule */}
          <Alert variant="info" className="mb-4">
            {KIND_NOTE[kind]}
          </Alert>
          {reading ? (
            <SavedQuestionDialog saved={reading} onClose={() => setReading(null)} />
          ) : null}
        </>
      }
    />
  );
}

/** Nothing starred and nothing missed are different facts, and only one of them is good news. */
const emptyFor = (kind: SavedQuestionKind) =>
  kind === SAVED_QUESTION_KIND.BOOKMARK
    ? { title: 'No bookmarks yet' }
    : { title: 'No mistakes recorded', icon: CircleCheck };

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
            Remove from this list
          </DropdownMenuItem>
        </RowActions>
      ),
    },
  ];
}

/** The institute's clock, never the device's — a student in another zone reads the same day. */
function whenItWasSaved(at: string): string {
  return new Date(at).toLocaleDateString('en-IN', {
    timeZone: INSTITUTE_TIME_ZONE,
    dateStyle: 'medium',
  });
}
