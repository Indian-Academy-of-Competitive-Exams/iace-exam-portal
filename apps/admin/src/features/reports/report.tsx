import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  FEATURE_KEYS,
  REPORTS,
  REPORT_PARAMS,
  REPORT_PARAM_FIELDS,
  REPORT_PERIODS,
  instituteDateTimeLabel,
  reportFieldsMissing,
  reportKeySchema,
  reportPeriodOf,
  reportQuerySchema,
  type ReportDocument,
  type ReportFact,
  type ReportKey,
  type ReportParam,
  type ReportPeriodRange,
  type ReportQueryInput,
  type ReportSpec,
  type ReportTable,
} from '@iace/contracts';
import { reportHtml } from '@iace/app-kit';
import {
  PageCrumbs,
  ReportTableView,
  printHtml,
  useFilterSpec,
  useFilters,
} from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  FILLS,
  Badge,
  Button,
  EmptyState,
  FormSection,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  SplitFrame,
  StatRow,
  cn,
  type TableFrameTab,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ExportButton } from '../../components/export-button';
import { NotFoundPage } from '../../components/not-found';
import { NAV_ITEMS, REPORT_PARAM_LABELS, reportQueryKey } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { reportFilters } from './report-filters';

export function ReportPage() {
  const { key = '' } = useParams();
  const parsed = reportKeySchema.safeParse(key);
  // Keyed, so a panel folded away on one report is back for the next, which has its own to ask.
  return parsed.success ? <Report key={parsed.data} reportKey={parsed.data} /> : <NotFoundPage />;
}

const paramsOf = (spec: ReportSpec): readonly ReportParam[] => [
  ...spec.needs,
  ...(spec.takes ?? []),
];

function Report({ reportKey }: Readonly<{ reportKey: ReportKey }>) {
  const spec: ReportSpec = REPORTS[reportKey];
  const { can } = useAuth();
  const url = useFilters<string>();

  // A report that cannot be read without a period opens on its row's own, so it is never blank.
  const opensOn: Partial<ReportPeriodRange> = spec.needs.includes(REPORT_PARAMS.PERIOD)
    ? reportPeriodOf(spec.period ?? REPORT_PERIODS.THIS_WEEK)
    : {};
  const held = (field: string): string =>
    url.get(field) || (opensOn[field as keyof ReportPeriodRange] ?? '');

  const fields: Record<string, string> = Object.fromEntries(
    paramsOf(spec)
      .flatMap((param): readonly string[] => REPORT_PARAM_FIELDS[param])
      .map((field) => [field, held(field)] as const)
      .filter(([, value]) => value !== ''),
  );
  const query: ReportQueryInput = fields;
  const asked = reportQuerySchema.safeParse(query);
  const missing = asked.success ? reportFieldsMissing(reportKey, asked.data) : [];
  const ready = asked.success && missing.length === 0;
  const issue = asked.success ? undefined : asked.error.issues[0];
  const atFault: readonly PropertyKey[] = issue ? issue.path : missing;
  // The first thing still to be chosen, or the one the address has wrong, which is what an empty page has to name.
  const lacking =
    paramsOf(spec).find((param) =>
      REPORT_PARAM_FIELDS[param].some((field) => atFault.includes(field)),
    ) ?? spec.needs[0];

  const report = useQuery({
    queryKey: reportQueryKey(reportKey, query),
    queryFn: () => api.admin.reports.read(reportKey, query),
    enabled: ready,
  });

  const filters = reportFilters(spec, {
    about: report.data?.about ?? [],
    fields,
    set: (changes) => url.set(changes),
  });
  // What a report is asked by is not narrowed any-or-all, so the filters are handed no match toggle.
  const { values, setFilter, clearFilters } = useFilterSpec(filters);
  const shown = { ...values, ...fields };

  if (!can(FEATURE_KEYS.REPORTS)) {
    return (
      <PageFrame>
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="Reports are not open to you" />
      </PageFrame>
    );
  }

  const document = report.data;
  const panes = document ? panesOf(document) : [];
  const open = panes.find((pane) => pane.value === url.get(OPEN_PANE)) ?? panes[0];

  // Several tables of one report are views of one record, so they are its tabs; one needs no strip.
  return (
    <SplitFrame
      fills
      collapsible
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: spec.title }]} />}
          title={spec.title}
          meta={document ? `As of ${instituteDateTimeLabel(document.asOf)}` : undefined}
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<Printer aria-hidden />}
                disabled={!document}
                onClick={() => document && printHtml(reportHtml(document))}
              >
                Print
              </Button>
              <ExportButton
                kind={reportKey}
                disabled={!ready}
                download={() => api.admin.reports.export(reportKey, query)}
              />
            </div>
          }
        />
      }
      filters={{ spec: filters, state: { values: shown, setFilter, clearFilters } }}
      side={
        document ? (
          <>
            <Facts title="Details" facts={document.about} />
            <Facts title="Summary" facts={document.figures} />
          </>
        ) : null
      }
      tabs={
        panes.length > 1 && open
          ? {
              value: open.value,
              onValueChange: (pane) => url.set({ [OPEN_PANE]: pane }),
              items: panes,
            }
          : undefined
      }
    >
      {open?.content ?? (
        <Absent
          lacking={lacking}
          refusal={issue?.code === 'custom' ? issue.message : undefined}
          ready={ready}
          failed={report.isError}
          loaded={Boolean(document)}
          retry={report.refetch}
        />
      )}
    </SplitFrame>
  );
}

/** Which of a report's tables is open. In the URL, so a link lands on the table it was sent about. */
const OPEN_PANE = 'table';
const LETTER_PANE = 'letter';

function panesOf({ preface, closing, tables }: ReportDocument): TableFrameTab[] {
  const letter: TableFrameTab[] =
    preface.length + closing.length > 0
      ? [
          {
            value: LETTER_PANE,
            label: 'Letter',
            content: <Letter preface={preface} closing={closing} />,
          },
        ]
      : [];
  return [
    ...letter,
    ...tables.map((table) => ({
      value: table.title,
      label: (
        <span className="flex items-center gap-2">
          {table.title}
          <Badge variant="neutral">{count(table.total)}</Badge>
        </span>
      ),
      content: <TablePane table={table} />,
    })),
  ];
}

function Centred({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-0 flex-1 items-center justify-center">{children}</div>;
}

/** What the card holds before there is a report in it: nothing chosen, nothing loaded, or nothing yet. */
function Absent({
  lacking,
  refusal,
  ready,
  failed,
  loaded,
  retry,
}: Readonly<{
  lacking: ReportParam | undefined;
  /** The schema's own sentence for an address it will not read: a period over a year, or ending before it starts. */
  refusal: string | undefined;
  ready: boolean;
  failed: boolean;
  loaded: boolean;
  retry: () => void;
}>) {
  if (refusal) {
    return (
      <Centred>
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title={refusal} />
      </Centred>
    );
  }
  if (!ready) {
    const wanted = lacking ? REPORT_PARAM_LABELS[lacking].toLowerCase() : 'report';
    return (
      <Centred>
        <EmptyState title={`No ${wanted} chosen`} />
      </Centred>
    );
  }
  if (failed) {
    return (
      <Centred>
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load this report"
          onRetry={retry}
        />
      </Centred>
    );
  }
  if (loaded) {
    return (
      <Centred>
        <EmptyState title="No rows" />
      </Centred>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Skeleton variant="title" />
      <SkeletonParagraph lines={8} />
    </div>
  );
}

/** One group of the report's own facts, in the card beside the rows they were summed from. */
function Facts({ title, facts }: Readonly<{ title: string; facts: readonly ReportFact[] }>) {
  if (facts.length === 0) return null;
  return (
    <FormSection title={title}>
      <div className="flex flex-col gap-2">
        {facts.map((fact) => (
          <StatRow
            key={fact.label}
            className="items-start"
            label={fact.label}
            value={<span className="block text-right">{fact.value ?? DASH}</span>}
          />
        ))}
      </div>
    </FormSection>
  );
}

/** A letter's own words: the record's content, as it will be printed, not the screen describing itself. */
function Letter({
  preface,
  closing,
}: Readonly<{ preface: readonly string[]; closing: readonly string[] }>) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto pt-4">
      <div className="flex max-w-3xl flex-col gap-3 text-sm text-foreground">
        {[...preface, ...closing].map((line) => (
          <p key={line} className="whitespace-pre-wrap">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

const DASH = '—';

/** One table of the report: the rows are the only thing in the frame that scrolls. */
function TablePane({ table }: Readonly<{ table: ReportTable }>) {
  // Print is cut at the wire's own ceiling; only the spreadsheet is never cut.
  const carriesAll =
    table.total > table.rows.length
      ? `Print carries ${count(table.rows.length)}, and Export every one.`
      : 'Print and Export carry every one.';
  return (
    <div className={cn(FILLS, 'gap-3')}>
      <ReportTableView table={table} carriesAll={carriesAll} />
    </div>
  );
}

const count = (rows: number) => rows.toLocaleString('en-IN');
