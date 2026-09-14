import { usePagedPicker } from '@iace/app-kit';
import { Combobox, plural } from '@iace/ui';
import { api } from '../lib/api';
import { durationLabel } from '../lib/duration';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';

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
  const configs = usePagedPicker({
    queryKey: [...QUERY_KEYS.BASE_CONFIGS, QUERY_SCOPES.PICKER, examStageId],
    fetchPage: (params) =>
      api.admin.baseConfigs.list({ ...params, examStageId, activeOnly: 'true' }),
    enabled: examStageId !== '',
  });

  return (
    <Combobox
      {...configs.paging}
      id={id}
      value={value}
      onChange={onChange}
      clearable={false}
      disabled={examStageId === ''}
      placeholder={examStageId === '' ? 'Choose a stage first' : 'Choose a base configuration'}
      items={configs.items.map((config) => ({
        value: config.id,
        label: config.name,
        hint: `${plural(config.totalQuestions, 'question')} · ${durationLabel(config.durationSec)}${
          config.isDefault ? " · the stage's default" : ''
        }`,
      }))}
      searchPlaceholder="Search base configurations"
      emptyLabel="No active base configuration for this stage"
    />
  );
}
