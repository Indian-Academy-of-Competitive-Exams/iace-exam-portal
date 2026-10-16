import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  SUPPORT_CATEGORY_INFO,
  SUPPORT_STATUSES,
  instituteDateTimeLabel,
  type SupportStatus,
  type TicketSummary,
} from '@iace/contracts';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  EMPTY_STATE_KINDS,
  EmptyState,
  PageFrame,
  PageHeader,
  Pagination,
  plural,
  type BadgeProps,
  type ListFilter,
} from '@iace/ui';
import { DividedList, DividedRow, RowsSkeleton } from '../../components/ui';
import { api } from '../../lib/api';
import {
  NAV_ITEMS,
  ROUTES,
  SUPPORT_LIST_QUERY_KEY,
  SUPPORT_STATUS_LABEL,
} from '../../lib/constants';

const STATUS_BADGE: Readonly<Record<SupportStatus, BadgeProps['variant']>> = {
  [SUPPORT_STATUSES.OPEN]: 'warning',
  [SUPPORT_STATUSES.ANSWERED]: 'success',
  [SUPPORT_STATUSES.CLOSED]: 'neutral',
};

const NO_FILTERS: ListFilter[] = [];

export function HelpPage() {
  const list = useListScreen({
    queryKey: SUPPORT_LIST_QUERY_KEY,
    filters: NO_FILTERS,
    toQuery: () => ({}),
    fetchPage: (params) => api.me.support.list(params),
  });

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Help"
          meta={list.hasLoaded ? plural(list.total, 'query', 'queries') : undefined}
          action={
            <Button asChild size="sm">
              <Link to={ROUTES.HELP_NEW}>
                <Plus aria-hidden />
                New query
              </Link>
            </Button>
          }
        />
      }
    >
      <Queries list={list} />
      {list.hasLoaded && list.total > 0 ? <Pagination {...list.pagination} /> : null}
    </PageFrame>
  );
}

function Queries({
  list,
}: Readonly<{
  list: {
    rows: readonly TicketSummary[];
    isLoading: boolean;
    isError?: boolean;
    retry?: () => void;
  };
}>) {
  if (list.isLoading) return <RowsSkeleton />;
  if (list.isError && list.rows.length === 0) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load your queries"
        onRetry={list.retry}
      />
    );
  }
  if (list.rows.length === 0) return <EmptyState title="No queries" />;

  return (
    <DividedList>
      {list.rows.map((ticket) => (
        <DividedRow
          key={ticket.id}
          lead={
            <Badge variant={STATUS_BADGE[ticket.status]} className="self-start">
              {SUPPORT_STATUS_LABEL[ticket.status]}
            </Badge>
          }
          title={
            <Link to={ROUTES.HELP_QUERY(ticket.id)} className="hover:underline">
              {SUPPORT_CATEGORY_INFO[ticket.category].label}
            </Link>
          }
          meta={instituteDateTimeLabel(ticket.lastMessageAt)}
        />
      ))}
    </DividedList>
  );
}
