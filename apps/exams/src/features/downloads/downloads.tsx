import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { instituteDateTimeLabel, type ReportDocument, type SatSitting } from '@iace/contracts';
import {
  DOWNLOAD_CHOICE_LABELS,
  DOWNLOAD_KINDS,
  DOWNLOAD_KIND_LABELS,
  downloadChoices,
  downloadKindOf,
  downloadOf,
  reportHtml,
  type DownloadAsk,
  type DownloadChoice,
  type DownloadKind,
} from '@iace/app-kit';
import {
  PageCrumbs,
  ReportTableView,
  printHtml,
  useFilterSpec,
  useFilters,
} from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  Button,
  Card,
  Combobox,
  EmptyState,
  PageFrame,
  PageHeader,
  plural,
  type ListFilter,
  type ListFilterControl,
} from '@iace/ui';
import { Hero, PageBody, ReportSkeleton, Section, StatTile, TileGrid } from '../../components/ui';
import { NAV_ITEMS } from '../../lib/constants';
import { ownReportQuery, performanceQuery } from '../../lib/queries';

/** `of` is the week, the month or the sitting, whichever the report is asked by. */
type DownloadField = 'report' | 'of';

const NO_SITTINGS: readonly SatSitting[] = [];
const DASH = '—';

/** The report first offered is the one an untouched address means, so it is the empty value. */
const KIND_ITEMS = Object.values(DOWNLOAD_KINDS).map((kind) => ({
  value: kind === DOWNLOAD_KINDS.WEEKLY ? '' : kind,
  label: DOWNLOAD_KIND_LABELS[kind],
}));

function downloadFilters(
  kind: DownloadKind,
  choices: readonly DownloadChoice[],
  set: (changes: Partial<Record<DownloadField, string | undefined>>) => void,
): ListFilter[] {
  const report: ListFilter = {
    key: 'report',
    kind: 'custom',
    label: 'Report',
    primary: true,
    width: 'w-56',
    render: (control: ListFilterControl) => (
      <Combobox
        {...control}
        clearable={false}
        items={KIND_ITEMS}
        // A week is not a month and neither is a sitting, so a new report lets go of the last one's.
        onChange={(next) => set({ report: next, of: undefined })}
      />
    ),
  };
  const label = DOWNLOAD_CHOICE_LABELS[kind];
  if (!label || choices.length === 0) return [report];
  return [
    report,
    { key: 'of', kind: 'choice', label, primary: true, width: 'w-80', items: choices },
  ];
}

/** A student's own reports: chosen, read on the page, then printed or saved as a PDF from the browser's dialog. */
export function DownloadsPage() {
  const url = useFilters<DownloadField>();
  const kind = downloadKindOf(url.get('report'));
  const trend = useQuery(performanceQuery);
  const sittings = trend.data?.sittings ?? NO_SITTINGS;

  const choices = useMemo(() => downloadChoices(kind, sittings), [kind, sittings]);
  const ask = useMemo(() => downloadOf(kind, url.get('of'), sittings), [kind, url, sittings]);

  const filters = downloadFilters(kind, choices, url.set);
  // One report is read at a time, so there is nothing for an any-or-all toggle to combine.
  const { values, setFilter, clearFilters } = useFilterSpec(filters);

  const client = useQueryClient();
  const print = useMutation({
    mutationFn: (asked: DownloadAsk) => client.ensureQueryData(ownReportQuery(asked)),
    onSuccess: (document) => printHtml(reportHtml(document)),
  });

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Downloads"
          action={
            <Button
              size="sm"
              icon={<Printer aria-hidden />}
              disabled={ask === null}
              loading={print.isPending}
              onClick={() => ask && print.mutate(ask)}
            >
              Print or save
            </Button>
          }
        />
      }
      filters={{ spec: filters, state: { values, setFilter, clearFilters } }}
    >
      {ask === null ? (
        <NoSitting waiting={trend.isPending} failed={trend.isError} retry={trend.refetch} />
      ) : (
        <Preview ask={ask} />
      )}
    </PageFrame>
  );
}

/** A test report with no sitting to name: they are still loading, did not load, or there are none. */
function NoSitting({
  waiting,
  failed,
  retry,
}: Readonly<{ waiting: boolean; failed: boolean; retry: () => void }>) {
  if (waiting) return <ReportSkeleton />;
  if (failed) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load your sittings"
        onRetry={retry}
      />
    );
  }
  return <EmptyState title="No marked sittings" />;
}

function Preview({ ask }: Readonly<{ ask: DownloadAsk }>) {
  const report = useQuery(ownReportQuery(ask));

  if (report.isPending) return <ReportSkeleton />;
  if (!report.data) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this report"
        onRetry={report.refetch}
      />
    );
  }
  return <Report document={report.data} />;
}

/** The report as it will print: what it covers, what it comes to, then the rows it was summed from. */
function Report({ document }: Readonly<{ document: ReportDocument }>) {
  return (
    <PageBody>
      <Hero
        eyebrow={`As of ${instituteDateTimeLabel(document.asOf)}`}
        title={document.title}
        meta={document.about.map((fact) => `${fact.label}: ${fact.value ?? DASH}`).join(' · ')}
      />

      {document.figures.length > 0 ? (
        <TileGrid>
          {document.figures.map((figure) => (
            <StatTile key={figure.label} label={figure.label} value={figure.value ?? DASH} />
          ))}
        </TileGrid>
      ) : null}

      {document.tables.map((table) => (
        <Section key={table.title} title={table.title} meta={plural(table.total, 'row')}>
          <Card className="flex flex-col gap-3 p-4">
            <ReportTableView table={table} carriesAll="Print carries every one." />
          </Card>
        </Section>
      ))}
    </PageBody>
  );
}
