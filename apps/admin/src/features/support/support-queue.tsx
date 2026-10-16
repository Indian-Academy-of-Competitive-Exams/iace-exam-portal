import { Link } from 'react-router-dom';
import {
  SUPPORT_ASSIGNEE_FILTERS,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  instituteDateTimeLabel,
  type AdminTicketSummary,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from '@iace/contracts';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  ListView,
  PageHeader,
  TableFrame,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
  type ListFilter,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ROUTES } from '../../lib/constants';
import { NAV_ITEMS } from '../../lib/nav';
import { QUERY_KEYS } from '../../lib/query-keys';
import { SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS } from '../../lib/labels';

/** The status row that lifts the queue's default; absent from the URL means Open. */
const ANY_STATUS = 'any';

const FILTERS = [
  { key: 'q', kind: 'search', label: 'Search', placeholder: 'Search students', primary: true },
  {
    key: 'status',
    kind: 'choice',
    label: 'Filter by status',
    primary: true,
    items: [
      { value: '', label: SUPPORT_STATUS_LABELS.OPEN },
      { value: SUPPORT_STATUSES.ANSWERED, label: SUPPORT_STATUS_LABELS.ANSWERED },
      { value: SUPPORT_STATUSES.CLOSED, label: SUPPORT_STATUS_LABELS.CLOSED },
      { value: ANY_STATUS, label: 'Any status' },
    ],
  },
  {
    key: 'assignee',
    kind: 'choice',
    label: 'Filter by assignee',
    primary: true,
    items: [
      { value: '', label: 'Anyone' },
      { value: SUPPORT_ASSIGNEE_FILTERS.MINE, label: 'Mine' },
      { value: SUPPORT_ASSIGNEE_FILTERS.UNCLAIMED, label: 'Unclaimed' },
      { value: SUPPORT_ASSIGNEE_FILTERS.UNLINKED, label: 'Unlinked' },
    ],
  },
  {
    key: 'category',
    kind: 'choice',
    label: 'Category',
    items: [
      { value: '', label: 'Any category' },
      ...Object.values(SUPPORT_CATEGORIES).map((category) => ({
        value: category,
        label: SUPPORT_CATEGORY_INFO[category].label,
      })),
    ],
  },
  {
    key: 'priority',
    kind: 'choice',
    label: 'Priority',
    items: [
      { value: '', label: 'Any priority' },
      ...Object.values(SUPPORT_PRIORITIES).map((priority) => ({
        value: priority,
        label: SUPPORT_PRIORITY_LABELS[priority],
      })),
    ],
  },
] as const satisfies readonly ListFilter[];

/** Students' queries, highest priority and longest waiting first. */
export function SupportQueuePage() {
  const queue = useListScreen({
    queryKey: QUERY_KEYS.SUPPORT,
    filters: FILTERS,
    toQuery: (values) => ({
      q: values.q || undefined,
      status: statusQuery(values.status),
      category: (values.category || undefined) as SupportCategory | undefined,
      priority: (values.priority || undefined) as SupportPriority | undefined,
      assignee: values.assignee || undefined,
    }),
    fetchPage: (params) => api.admin.support.list(params),
  });

  return (
    <TableFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Queries" />}
    >
      <ListView
        // The endpoint always narrows by every filter, so "match any" would be a control that lies.
        list={{ ...queue, setMatchAny: undefined }}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        filters={FILTERS}
        empty="No queries"
        emptyFiltered="No query matches"
      />
    </TableFrame>
  );
}

const statusQuery = (value: string): SupportStatus | undefined => {
  if (value === ANY_STATUS) return undefined;
  return (value || SUPPORT_STATUSES.OPEN) as SupportStatus;
};

const COLUMNS: DataTableColumn<AdminTicketSummary>[] = [
  {
    key: 'category',
    header: 'Query',
    className: 'max-w-48 font-medium',
    cell: (row) => (
      <Link to={ROUTES.SUPPORT_TICKET(row.id)} className={linkVariants()}>
        <TruncatedText>{row.title ?? SUPPORT_CATEGORY_INFO[row.category].label}</TruncatedText>
      </Link>
    ),
  },
  {
    key: 'categoryLabel',
    header: 'Category',
    cell: (row) => SUPPORT_CATEGORY_INFO[row.category].label,
  },
  {
    key: 'priority',
    header: 'Priority',
    cell: (row) =>
      row.priority === SUPPORT_PRIORITIES.HIGH ? (
        <Badge variant="danger">{SUPPORT_PRIORITY_LABELS.HIGH}</Badge>
      ) : null,
  },
  {
    key: 'student',
    header: 'Student',
    className: 'max-w-56',
    cell: (row) =>
      row.linked ? (
        <TruncatedText>{row.studentName}</TruncatedText>
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <TruncatedText>{row.claimedName}</TruncatedText>
          <Badge variant="warning">Unlinked</Badge>
        </span>
      ),
  },
  { key: 'status', header: 'Status', cell: (row) => SUPPORT_STATUS_LABELS[row.status] },
  {
    key: 'assignee',
    header: 'Assignee',
    className: 'max-w-48',
    cell: (row) => <TruncatedText>{row.assigneeName}</TruncatedText>,
  },
  {
    key: 'lastMessageAt',
    header: 'Last message',
    cell: (row) => instituteDateTimeLabel(row.lastMessageAt),
  },
];
