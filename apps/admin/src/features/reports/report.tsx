import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  FEATURE_KEYS,
  REPORTS,
  REPORT_PARAMS,
  REPORT_PARAM_FIELDS,
  REPORT_PERIODS,
  holdsFigures,
  instituteDateTimeLabel,
  reportFieldsMissing,
  reportKeySchema,
  reportPeriodOf,
  reportQuerySchema,
  type ReportCell,
  type ReportDocument,
  type ReportKey,
  type ReportParam,
  type ReportPeriodRange,
  type ReportQueryInput,
  type ReportSpec,
  type ReportTable,
} from '@iace/contracts';
import { reportHtml } from '@iace/app-kit';
import { PageCrumbs, printHtml, useFilterSpec, useFilters } from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  DataTable,
  EmptyState,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  SkeletonParagraph,
  StatRow,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ExportButton } from '../../components/export-button';
import { NotFoundPage } from '../../components/not-found';
import { NAV_ITEMS, REPORT_PARAM_LABELS, reportQueryKey } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { reportFilters } from './report-filters';

/** A screen previews a report; the printer and the spreadsheet carry it whole. */
const PREVIEW_ROWS = 200;

export function ReportPage() {
  const { key = '' } = useParams();
  const parsed = reportKeySchema.safeParse(key);
  return parsed.success ? <Report reportKey={parsed.data} /> : <NotFoundPage />;
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
  // The first thing still to be chosen, which is what an empty page has to name.
  const lacking =
    spec.needs.find((param) =>
      REPORT_PARAM_FIELDS[param].some((field) => (missing as readonly string[]).includes(field)),
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
  // What a report is asked by is not narrowed any-or-all, so the bar is handed no match toggle.
  const { values, setFilter, clearFilters } = useFilterSpec(filters);
  const shown = { ...values, ...fields };

  if (!can(FEATURE_KEYS.REPORTS)) {
    return (
      <PageFrame>
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="Reports are not open to you" />
      </PageFrame>
    );
  }

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: spec.title }]} />}
          title={spec.title}
          meta={report.data ? `As of ${instituteDateTimeLabel(report.data.asOf)}` : undefined}
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<Printer aria-hidden />}
                disabled={!report.data}
                onClick={() => report.data && printHtml(reportHtml(report.data))}
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
    >
      <Body lacking={lacking} ready={ready} report={report} />
    </PageFrame>
  );
}

function Body({
  lacking,
  ready,
  report,
}: Readonly<{
  lacking: ReportParam | undefined;
  ready: boolean;
  report: { data?: ReportDocument; isError: boolean; refetch: () => void };
}>) {
  if (!ready) {
    const wanted = lacking ? REPORT_PARAM_LABELS[lacking].toLowerCase() : 'report';
    return <EmptyState title={`No ${wanted} chosen`} />;
  }
  if (report.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this report"
        onRetry={report.refetch}
      />
    );
  }
  if (!report.data) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={8} />
      </div>
    );
  }

  const { about, preface, figures, tables, closing } = report.data;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-xl flex-col gap-1.5">
        {about.map((fact) => (
          <StatRow key={fact.label} label={fact.label} value={fact.value ?? DASH} />
        ))}
      </div>
      <Letter lines={preface} />
      {figures.length === 0 ? null : (
        <MetricGroup>
          {figures.map((figure) => (
            <Metric
              key={figure.label}
              size="sm"
              label={figure.label}
              value={figure.value ?? DASH}
            />
          ))}
        </MetricGroup>
      )}
      {tables.map((table) => (
        <TablePreview key={table.title} table={table} />
      ))}
      <Letter lines={closing} />
    </div>
  );
}

/** A letter's own words: the record's content, as it will be printed, not the screen describing itself. */
function Letter({ lines }: Readonly<{ lines: readonly string[] }>) {
  if (lines.length === 0) return null;
  return (
    <div className="flex max-w-3xl flex-col gap-2 text-sm text-foreground">
      {lines.map((line) => (
        <p key={line} className="whitespace-pre-wrap">
          {line}
        </p>
      ))}
    </div>
  );
}

const DASH = '—';

interface PreviewRow {
  id: string;
  cells: readonly ReportCell[];
}

function TablePreview({ table }: Readonly<{ table: ReportTable }>) {
  const rows = useMemo(
    () => table.rows.slice(0, PREVIEW_ROWS).map((cells, at) => ({ id: String(at), cells })),
    [table.rows],
  );
  const columns = useMemo(
    () =>
      table.columns.map((header, at): DataTableColumn<PreviewRow> => ({
        key: String(at),
        header,
        numeric: holdsFigures(table, at),
        className: 'max-w-[18rem]',
        cell: (row) => cellOf(row.cells[at] ?? null),
      })),
    [table],
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title={table.title} meta={plural(table.total, 'row')} />
      {table.total > rows.length ? (
        <Alert variant="info">{hiddenRows(table, rows.length)}</Alert>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={false}
        empty="No rows"
      />
    </section>
  );
}

function cellOf(value: ReportCell) {
  return typeof value === 'number' ? value : <TruncatedText>{value}</TruncatedText>;
}

const count = (rows: number) => rows.toLocaleString('en-IN');

function hiddenRows(table: ReportTable, shown: number): string {
  const first = `The first ${count(shown)} of ${count(table.total)} rows.`;
  return table.total > table.rows.length
    ? `${first} Print carries ${count(table.rows.length)}, and Export every one.`
    : `${first} Print and Export carry every one.`;
}
