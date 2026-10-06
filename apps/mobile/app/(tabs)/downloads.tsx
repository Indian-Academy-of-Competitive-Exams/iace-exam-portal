/// <reference types="nativewind/types" />
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { printAsync } from 'expo-print';
import {
  progressDownloads,
  reportHtml,
  scoreCardDownloads,
  type ReportDownload,
} from '@iace/app-kit';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { Skeleton } from '../../src/components/ui/skeleton';
import { Text } from '../../src/components/ui/text';
import { api } from '../../src/lib/api';
import { cn } from '../../src/lib/cn';
import { performanceQuery } from '../../src/lib/queries';
import { useRefetchOnFocus } from '../../src/lib/use-refetch-on-focus';

/** A student's own reports, handed to the phone's print service — which is also where one is saved as a PDF. */
export default function DownloadsScreen() {
  useRefetchOnFocus();
  const progress = useMemo(() => progressDownloads(), []);
  const trend = useQuery(performanceQuery);
  const cards = useMemo(() => scoreCardDownloads(trend.data?.sittings ?? []), [trend.data]);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 px-5 py-6">
      <Text variant="title">Downloads</Text>

      <View className="gap-3">
        <Text variant="section">Progress reports</Text>
        <DownloadList downloads={progress} />
      </View>

      <View className="gap-3">
        <Text variant="section">Score cards</Text>
        {trend.isLoading ? <Skeleton className="h-16 rounded-xl" /> : null}
        {trend.isError ? (
          <EmptyState
            kind={EMPTY_STATE_KINDS.FAILURE}
            title="Sittings did not load"
            onRetry={trend.refetch}
          />
        ) : null}
        {trend.data && cards.length === 0 ? <EmptyState title="No marked sittings" /> : null}
        {cards.length > 0 ? <DownloadList downloads={cards} /> : null}
      </View>
    </ScrollView>
  );
}

function DownloadList({ downloads }: Readonly<{ downloads: readonly ReportDownload[] }>) {
  return (
    <Card>
      {downloads.map((download, index) => (
        <DownloadRow key={download.id} download={download} isFirst={index === 0} />
      ))}
    </Card>
  );
}

function DownloadRow({
  download,
  isFirst,
}: Readonly<{ download: ReportDownload; isFirst: boolean }>) {
  const print = useMutation({
    mutationFn: async () => {
      const document = await api.me.report(download.key, download.query);
      await printAsync({ html: reportHtml(document) });
    },
  });

  return (
    <View
      className={cn(
        'flex-row items-center justify-between gap-3 p-4',
        !isFirst && 'border-t border-border',
      )}
    >
      <View className="shrink gap-0.5">
        <Text variant="subsection">{download.title}</Text>
        {download.meta ? <Text variant="meta">{download.meta}</Text> : null}
      </View>
      <Button variant="outline" size="sm" loading={print.isPending} onPress={() => print.mutate()}>
        Print or save
      </Button>
    </View>
  );
}
