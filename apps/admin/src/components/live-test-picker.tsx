import { useState } from 'react';
import { INSTITUTE_TIME_ZONE, PAGE_SIZE_MAX, type LiveOpsTest } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';

const WINDOW_FORMATTER = new Intl.DateTimeFormat(undefined, {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Which test is being watched. Every panel on the ops screen is read through this one choice. */
export function LiveTestPicker({
  value,
  onChange,
}: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: [...QUERY_KEYS.LIVE_OPS, QUERY_SCOPES.PICKER, search],
    fetchPage: (page) => api.admin.liveOps.tests({ page, pageSize: PAGE_SIZE_MAX, q: search }),
  });

  return (
    <Combobox
      value={value}
      onChange={onChange}
      clearable={false}
      placeholder="Choose a test"
      className="w-72"
      items={pages.items.map((test) => ({
        value: test.id,
        label: test.title ?? test.seriesName,
        hint: windowLabel(test),
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search tests"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No active test"
    />
  );
}

function windowLabel(test: LiveOpsTest): string {
  const opens = test.opensAt === null ? 'Open' : WINDOW_FORMATTER.format(new Date(test.opensAt));
  const closes = test.closesAt === null ? null : WINDOW_FORMATTER.format(new Date(test.closesAt));
  const window = closes === null ? opens : `${opens} – ${closes}`;
  return `${test.seriesName} · ${window}`;
}
