import { INSTITUTE_TIME_ZONE, type LiveOpsTest } from '@iace/contracts';
import { usePagedPicker } from '@iace/app-kit';
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
  const tests = usePagedPicker({
    queryKey: [...QUERY_KEYS.LIVE_OPS, QUERY_SCOPES.PICKER],
    fetchPage: (params) => api.admin.liveOps.tests(params),
  });

  return (
    <Combobox
      {...tests.paging}
      value={value}
      onChange={onChange}
      clearable={false}
      placeholder="Choose a test"
      className="w-72"
      items={tests.items.map((test) => ({
        value: test.id,
        label: test.title ?? test.seriesName,
        hint: windowLabel(test),
      }))}
      searchPlaceholder="Search tests"
      emptyLabel="No active test"
    />
  );
}

function windowLabel(test: LiveOpsTest): string {
  const opens = test.opensAt === null ? 'Open' : WINDOW_FORMATTER.format(new Date(test.opensAt));
  return `${test.seriesName} · ${opens}`;
}
