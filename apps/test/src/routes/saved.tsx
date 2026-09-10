/**
 * The two lists a student keeps of the bank: BOOKMARKS they starred in a review, and MISTAKES the
 * fold wrote for them. A feed parted by hairlines rather than a ListView, for the reason
 * `notifications.tsx` gives — this is something a student reads, not an admin data table.
 */
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Trash2 } from 'lucide-react';
import { useInfinitePages } from '@iace/app-kit';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PanelFrame,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
import { NAV_ITEMS, ROUTES, SAVED_PAGE_SIZE, savedQueryKey } from '../lib/constants';

const KIND_KEY = 'list';
const SKELETON_KEYS = ['a', 'b', 'c', 'd'];

/** What each list is for, said once at the top rather than on every row. */
const KIND_NOTE: Readonly<Record<SavedQuestionKind, string>> = {
  [SAVED_QUESTION_KIND.BOOKMARK]: 'Starred from a solution review, and yours to drop.',
  [SAVED_QUESTION_KIND.MISTAKE]:
    'Added when a marked answer was wrong. Clearing one brings it back only if you miss it again.',
};

export function SavedPage() {
  const filters = useFilters<typeof KIND_KEY>();
  const chosen = filters.get(KIND_KEY);
  const kind: SavedQuestionKind = isKind(chosen) ? chosen : SAVED_QUESTION_KIND.BOOKMARK;

  return (
    <PanelFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Saved questions" />}
      tabs={{
        value: kind,
        onValueChange: (next) => filters.set({ [KIND_KEY]: next }),
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

function SavedList({ kind }: Readonly<{ kind: SavedQuestionKind }>) {
  const list = useInfinitePages({
    queryKey: savedQueryKey(kind),
    fetchPage: (page) => api.me.savedQuestions({ kind, page, pageSize: SAVED_PAGE_SIZE }),
  });

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} variant="row" className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your saved questions did not load"
        onRetry={list.retry}
      />
    );
  }
  if (list.items.length === 0) return <Empty kind={kind} />;

  return (
    <div className="flex flex-col gap-4">
      {/* ui-copy-ok: rule */}
      <Alert variant="info">{KIND_NOTE[kind]}</Alert>

      {/* The rule is on the WRAPPER and full width; the row inside keeps its radius and its hover. */}
      <div className="flex flex-col divide-y divide-border">
        {list.items.map((row) => (
          <div key={row.id} className="py-1">
            <SavedRow saved={row} />
          </div>
        ))}
      </div>

      {list.hasMore ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={list.loadMore}
          disabled={list.isLoadingMore}
        >
          Show older
        </Button>
      ) : null}
    </div>
  );
}

/** Nothing starred and nothing missed are different facts, and only one of them is good news. */
const Empty = ({ kind }: Readonly<{ kind: SavedQuestionKind }>) =>
  kind === SAVED_QUESTION_KIND.BOOKMARK ? (
    <EmptyState title="No bookmarks yet" />
  ) : (
    <EmptyState icon={CircleCheck} title="No mistakes recorded" />
  );

/** A row in one panel, never its own card: a card inside the frame's card is a card in a card. */
function SavedRow({ saved }: Readonly<{ saved: SavedQuestion }>) {
  const queryClient = useQueryClient();
  const drop = useMutation({
    meta: { success: 'Removed from your list.' },
    mutationFn: () => api.me.removeSavedQuestion(saved.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedQueryKey(saved.kind) }),
  });

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-md p-4 transition-colors hover:bg-muted/50">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{saved.subject}</Badge>
          {saved.topic ? <Badge variant="neutral">{saved.topic}</Badge> : null}
        </span>
        <span className="text-sm text-foreground">{saved.stemPreview}</span>
        <span className="text-xs text-muted-foreground">{whenItWasSaved(saved.createdAt)}</span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {saved.attemptId ? (
          <Button asChild size="sm" variant="outline">
            <Link to={ROUTES.REPORT_TAB(saved.attemptId, 'solutions')}>Open solution</Link>
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              loading={drop.isPending}
              onClick={() => drop.mutate()}
            >
              <Trash2 aria-hidden />
              <span className="sr-only">Remove from this list</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from this list</TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}

/** The institute's clock, never the device's — a student in another zone reads the same day. */
function whenItWasSaved(at: string): string {
  return new Date(at).toLocaleDateString('en-IN', {
    timeZone: INSTITUTE_TIME_ZONE,
    dateStyle: 'medium',
  });
}
