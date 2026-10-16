import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  SUPPORT_CATEGORY_INFO,
  SUPPORT_STATUS_STUDENT_LABEL,
  instituteDateTimeLabel,
  type TicketSummary,
} from '@iace/contracts';
import { SUPPORT_FILTERS, supportQuery } from '@iace/app-kit';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  EmptyState,
  ListView,
  PageHeader,
  SplitFrame,
  TruncatedText,
  cn,
  linkVariants,
  plural,
  type DataTableColumn,
  type ListFilter,
} from '@iace/ui';
import { api } from '../../lib/api';
import {
  HELP_PARAMS,
  NAV_ITEMS,
  ROUTES,
  SUPPORT_LIST_QUERY_KEY,
  SUPPORT_STATUS_BADGE,
} from '../../lib/constants';
import { NewQueryDialog } from './new-query-dialog';
import { QueryPane } from './query-pane';

const FILTERS = SUPPORT_FILTERS as ListFilter[];

/** Their queries beside the one open: picking a row swaps the thread, never the page. */
export function HelpPage() {
  const { ticketId } = useParams();
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const raising = params.has(HELP_PARAMS.RAISE);

  const list = useListScreen({
    queryKey: SUPPORT_LIST_QUERY_KEY,
    filters: FILTERS,
    toQuery: supportQuery,
    fetchPage: (query) => api.me.support.list(query),
  });

  const setRaising = (open: boolean) =>
    setParams((next) => {
      if (open) next.set(HELP_PARAMS.RAISE, '');
      else {
        next.delete(HELP_PARAMS.RAISE);
        next.delete(HELP_PARAMS.ATTEMPT);
      }
      return next;
    });

  return (
    <SplitFrame
      fills
      wideSide
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Help"
          meta={list.hasLoaded ? plural(list.total, 'query', 'queries') : undefined}
          action={
            <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setRaising(true)}>
              New query
            </Button>
          }
        />
      }
      side={
        ticketId ? (
          <QueryPane key={ticketId} ticketId={ticketId} onRaise={() => setRaising(true)} />
        ) : (
          <EmptyState title="No query open" />
        )
      }
    >
      <ListView
        // The endpoint always narrows by every filter, so "match any" would be a control that lies.
        list={{ ...list, setMatchAny: undefined }}
        columns={columnsFor(ticketId, search)}
        rowKey={(row) => row.id}
        filters={FILTERS}
        empty="No queries"
        emptyFiltered="No query matches"
      />

      <NewQueryDialog open={raising} onOpenChange={setRaising} />
    </SplitFrame>
  );
}

const columnsFor = (
  openId: string | undefined,
  search: string,
): DataTableColumn<TicketSummary>[] => [
  {
    key: 'title',
    header: 'Query',
    className: 'max-w-64',
    cell: (row) => (
      <Link
        to={{ pathname: ROUTES.HELP_QUERY(row.id), search }}
        aria-current={row.id === openId ? 'true' : undefined}
        className={cn(linkVariants(), row.id === openId && 'font-semibold')}
      >
        <TruncatedText>{row.title ?? SUPPORT_CATEGORY_INFO[row.category].label}</TruncatedText>
      </Link>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    cell: (row) => SUPPORT_CATEGORY_INFO[row.category].label,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <Badge variant={SUPPORT_STATUS_BADGE[row.status]}>
        {SUPPORT_STATUS_STUDENT_LABEL[row.status]}
      </Badge>
    ),
  },
  {
    key: 'lastMessageAt',
    header: 'Updated',
    cell: (row) => instituteDateTimeLabel(row.lastMessageAt),
  },
];
