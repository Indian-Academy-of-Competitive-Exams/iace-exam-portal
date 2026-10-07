/// <reference types="nativewind/types" />
import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { printAsync } from 'expo-print';
import { type SatSitting } from '@iace/contracts';
import {
  DOWNLOAD_CHOICE_LABELS,
  DOWNLOAD_KINDS,
  DOWNLOAD_KIND_LABELS,
  downloadChoices,
  downloadKindOf,
  downloadOf,
  reportHtml,
  type DownloadAsk,
  type DownloadKind,
} from '@iace/app-kit';
import { Button } from '../../src/components/ui/button';
import { ChipRow } from '../../src/components/ui/chip-row';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { Skeleton } from '../../src/components/ui/skeleton';
import { StatTile, StatTileRow } from '../../src/components/ui/stat-tile';
import { Text } from '../../src/components/ui/text';
import { ownReportQuery, performanceQuery } from '../../src/lib/queries';
import { useRefetchOnFocus } from '../../src/lib/use-refetch-on-focus';

const NO_SITTINGS: readonly SatSitting[] = [];
const DASH = '—';

const KIND_OPTIONS = Object.values(DOWNLOAD_KINDS).map((kind) => ({
  value: kind,
  label: DOWNLOAD_KIND_LABELS[kind],
}));

/** A student's own reports: chosen here, then handed to the phone's print service — which is also where one is saved as a PDF. */
export default function DownloadsScreen() {
  useRefetchOnFocus();
  const [kind, setKind] = useState<DownloadKind>(DOWNLOAD_KINDS.WEEKLY);
  const [chosen, setChosen] = useState('');
  const trend = useQuery(performanceQuery);
  const sittings = trend.data?.sittings ?? NO_SITTINGS;

  const choices = useMemo(() => downloadChoices(kind, sittings), [kind, sittings]);
  const ask = useMemo(() => downloadOf(kind, chosen, sittings), [kind, chosen, sittings]);

  const client = useQueryClient();
  const print = useMutation({
    mutationFn: async (asked: DownloadAsk) => {
      const document = await client.ensureQueryData(ownReportQuery(asked));
      await printAsync({ html: reportHtml(document) });
    },
  });

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <Text variant="title">Downloads</Text>

      <ChipRow
        label="Report"
        scroll
        options={KIND_OPTIONS}
        value={kind}
        // A week is not a month and neither is a sitting, so a new report lets go of the last one's.
        onChange={(next) => {
          setKind(downloadKindOf(next));
          setChosen('');
        }}
      />
      {choices.length > 0 ? (
        <ChipRow
          label={DOWNLOAD_CHOICE_LABELS[kind]}
          scroll
          options={choices}
          value={chosen}
          onChange={setChosen}
        />
      ) : null}

      {ask === null ? (
        <NoSitting waiting={trend.isLoading} failed={trend.isError} retry={trend.refetch} />
      ) : (
        <>
          <Figures ask={ask} />
          <Button loading={print.isPending} onPress={() => print.mutate(ask)}>
            Print or save
          </Button>
        </>
      )}
    </ScrollView>
  );
}

/** A test report with no sitting to name: they are still loading, did not load, or there are none. */
function NoSitting({
  waiting,
  failed,
  retry,
}: Readonly<{ waiting: boolean; failed: boolean; retry: () => void }>) {
  if (waiting) return <Skeleton className="h-24 rounded-xl" />;
  if (failed) {
    return (
      <EmptyState kind={EMPTY_STATE_KINDS.FAILURE} title="Sittings did not load" onRetry={retry} />
    );
  }
  return <EmptyState title="No marked sittings" />;
}

/** What the chosen report comes to, read before it is printed; its rows are on the page it prints. */
function Figures({ ask }: Readonly<{ ask: DownloadAsk }>) {
  const report = useQuery(ownReportQuery(ask));

  if (report.isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (!report.data) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This report did not load"
        onRetry={report.refetch}
      />
    );
  }
  return (
    <>
      <Text variant="section">{report.data.title}</Text>
      <StatTileRow>
        {report.data.figures.map((figure) => (
          <StatTile key={figure.label} label={figure.label} value={figure.value ?? DASH} />
        ))}
      </StatTileRow>
    </>
  );
}
