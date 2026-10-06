import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  progressDownloads,
  reportHtml,
  scoreCardDownloads,
  type ReportDownload,
} from '@iace/app-kit';
import { PageCrumbs, printHtml } from '@iace/app-kit/browser';
import { EMPTY_STATE_KINDS, Button, EmptyState, PageFrame, PageHeader, plural } from '@iace/ui';
import { DividedList, DividedRow, PageBody, RowsSkeleton, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS } from '../../lib/constants';
import { performanceQuery } from '../../lib/queries';

/** A student's own reports, each printed or saved as a PDF from the browser's own dialog. */
export function DownloadsPage() {
  const progress = useMemo(() => progressDownloads(), []);
  const trend = useQuery(performanceQuery);
  const cards = useMemo(() => scoreCardDownloads(trend.data?.sittings ?? []), [trend.data]);

  return (
    <PageFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Downloads" />}
    >
      <PageBody>
        <Section title="Progress reports">
          <DividedList>
            {progress.map((download) => (
              <DownloadRow key={download.id} download={download} />
            ))}
          </DividedList>
        </Section>

        <Section
          title="Score cards"
          meta={trend.data ? plural(cards.length, 'sitting') : undefined}
        >
          {trend.isPending ? <RowsSkeleton /> : null}
          {trend.isError ? (
            <EmptyState
              kind={EMPTY_STATE_KINDS.FAILURE}
              title="Could not load your sittings"
              onRetry={trend.refetch}
            />
          ) : null}
          {trend.data && cards.length === 0 ? <EmptyState title="No marked sittings" /> : null}
          {cards.length > 0 ? (
            <DividedList>
              {cards.map((download) => (
                <DownloadRow key={download.id} download={download} />
              ))}
            </DividedList>
          ) : null}
        </Section>
      </PageBody>
    </PageFrame>
  );
}

function DownloadRow({ download }: Readonly<{ download: ReportDownload }>) {
  const print = useMutation({
    mutationFn: () => api.me.report(download.key, download.query),
    onSuccess: (document) => printHtml(reportHtml(document)),
  });

  return (
    <DividedRow
      title={download.title}
      meta={download.meta}
      action={
        <Button
          size="sm"
          variant="outline"
          icon={<Printer aria-hidden />}
          loading={print.isPending}
          onClick={() => print.mutate()}
        >
          Print or save
        </Button>
      }
    />
  );
}
