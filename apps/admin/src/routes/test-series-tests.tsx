import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type SeriesTestRow,
  type TestSeriesSummary,
  fromInstituteWallTime,
  instituteWallTime,
} from '@iace/contracts';
import {
  Button,
  DataTable,
  DateTimePicker,
  DropdownMenuItem,
  FormDialog,
  FormField,
  FormSection,
  RowActions,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES } from '../lib/constants';
import { opensLabel } from '../lib/schedule-format';
import { useAuth } from '../providers/auth';
import { testsKey } from './test-series-detail';

/** The instant an exam starts, said in the institute's clock wherever the admin is sitting. */

interface UnlockFormValues {
  unlockAt: string;
}
export function SeriesTests({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const queryClient = useQueryClient();
  const canWrite = useAuth().can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [opening, setOpening] = useState<SeriesTestRow | null>(null);

  const tests = useQuery({
    queryKey: testsKey(series.id),
    queryFn: () => api.admin.testSeries.tests(series.id),
  });

  const held = (next: SeriesTestRow[]) => {
    queryClient.setQueryData(testsKey(series.id), next);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
  };

  return (
    <FormSection title="Tests">
      {canWrite ? (
        <div className="flex justify-end">
          <Button size="sm" asChild>
            {/* The series goes with it, so the builder opens knowing the mode and often the stage. */}
            <Link to={`${ROUTES.TEST_NEW}?series=${series.id}`}>
              <Plus aria-hidden />
              New test
            </Link>
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={testColumns({ canWrite, onOpening: setOpening })}
        rows={tests.data ?? []}
        rowKey={(row) => row.testId}
        isLoading={tests.isLoading}
        empty="No test in this series yet. Build the first one here; its Offer step moves it to another series later."
      />

      {opening ? (
        <UnlockDialog
          key={opening.testId}
          series={series}
          row={opening}
          onClose={() => setOpening(null)}
          onSaved={held}
        />
      ) : null}
    </FormSection>
  );
}

function testColumns(
  options: Readonly<{
    canWrite: boolean;
    onOpening: (row: SeriesTestRow) => void;
  }>,
): DataTableColumn<SeriesTestRow>[] {
  const { canWrite, onOpening } = options;

  return [
    { key: 'order', header: '#', numeric: true, cell: (row) => row.order ?? '—' },
    {
      key: 'title',
      header: 'Test',
      className: 'w-full max-w-0',
      cell: (row) => <TruncatedText>{row.title}</TruncatedText>,
    },
    {
      key: 'opens',
      header: 'Opens',
      className: 'max-w-56',
      cell: (row) => <TruncatedText>{opensLabel(row.unlockAt)}</TruncatedText>,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) =>
        canWrite ? (
          <RowActions label={`Actions for ${row.title ?? 'this test'}`}>
            <DropdownMenuItem onSelect={() => onOpening(row)}>
              <Clock aria-hidden />
              Set when it opens
            </DropdownMenuItem>
          </RowActions>
        ) : null,
    },
  ];
}

/** Wall time in, an instant out: `packages/ui` holds no zone, so the conversion is the app's. */
function UnlockDialog({
  series,
  row,
  onClose,
  onSaved,
}: Readonly<{
  series: TestSeriesSummary;
  row: SeriesTestRow;
  onClose: () => void;
  onSaved: (next: SeriesTestRow[]) => void;
}>) {
  const form = useForm<UnlockFormValues>({
    defaultValues: { unlockAt: row.unlockAt ? instituteWallTime(new Date(row.unlockAt)) : '' },
  });
  const unlockAt = useWatch({ control: form.control, name: 'unlockAt' });

  const save = useMutation({
    meta: { success: 'Opening time saved.' },
    mutationFn: (wall: string) =>
      api.admin.testSeries.setTestUnlock(series.id, row.testId, {
        unlockAt: wall ? fromInstituteWallTime(wall).toISOString() : null,
      }),
    onSuccess: (next) => {
      onClose();
      onSaved(next);
    },
    onError: (error) => applyFieldErrors(error, form.setError, ['unlockAt']),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => save.mutate(values.unlockAt)}
      title={`When does ${row.title ?? 'this test'} open?`}
      description={`Every branch running ${series.name} sits it from that instant. Leave it empty and it opens as soon as a student reaches the series.`}
      submitLabel="Save the time"
      loading={save.isPending}
    >
      <FormField form={form} name="unlockAt" label="Opens (IST)">
        {(control) => (
          <DateTimePicker
            id={control.id}
            aria-label="Opens"
            aria-describedby={control['aria-describedby']}
            value={unlockAt}
            onChange={(next) => form.setValue('unlockAt', next, { shouldDirty: true })}
          />
        )}
      </FormField>
    </FormDialog>
  );
}
