import { useState } from 'react';
import { PAGE_SIZE_MAX } from '@iace/contracts';
import { useInfinitePages } from '@iace/app-kit';
import { Combobox, plural } from '@iace/ui';
import { api } from '../lib/api';
import { durationLabel } from '../lib/duration';

/** The blueprints a test can be built on: one stage's, and only the ones still offered. */
export function BaseConfigPicker({
  examStageId,
  value,
  onChange,
  id,
}: Readonly<{
  examStageId: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
}>) {
  const [search, setSearch] = useState('');

  const pages = useInfinitePages({
    queryKey: ['admin', 'base-configs', 'picker', examStageId, search],
    fetchPage: (page) =>
      api.admin.baseConfigs.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: search,
        examStageId,
        activeOnly: 'true',
      }),
    enabled: examStageId !== '',
  });

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      clearable={false}
      disabled={examStageId === ''}
      placeholder={examStageId === '' ? 'Choose a stage first' : 'Choose a base configuration'}
      items={pages.items.map((config) => ({
        value: config.id,
        label: config.name,
        hint: `${plural(config.totalQuestions, 'question')} · ${durationLabel(config.durationSec)}${
          config.isDefault ? " · the stage's default" : ''
        }`,
      }))}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search base configurations"
      hasMore={pages.hasMore}
      onLoadMore={pages.loadMore}
      isLoading={pages.isLoading}
      isLoadingMore={pages.isLoadingMore}
      emptyLabel="No active base configuration for this stage"
    />
  );
}
