import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  FEATURE_KEYS,
  EVALUATION_MODE_LABELS,
  PERMISSION_LEVELS,
  type SeriesTestRow,
  type TestSeriesSummary,
  seriesModeMismatch,
} from '@iace/contracts';
import {
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  FormDialog,
  FormField,
  FormSection,
  RowActions,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { TestStatusBadges } from '../components/test-status-badges';
import { durationLabel } from '../lib/duration';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES } from '../lib/constants';
import { opensLabel } from '../lib/schedule-format';
import { useAuth } from '../providers/auth';
import { NO_SERIES, TestSeriesPicker, type ChosenSeries } from '../components/access-picker';
import { testsKey } from './test-series-detail';

interface MoveFormValues {
  testSeriesId: string;
}
export function SeriesTests({ series }: Readonly<{ series: TestSeriesSummary }>) {
  const queryClient = useQueryClient();
  const canWrite = useAuth().can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [moving, setMoving] = useState<SeriesTestRow | null>(null);

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
        columns={testColumns({ canWrite, onMoving: setMoving })}
        rows={tests.data ?? []}
        rowKey={(row) => row.testId}
        isLoading={tests.isLoading}
        empty={{
          title: 'No test in this series yet',
          hint: 'Build the first one here; its Offer step sets when it opens.',
        }}
      />

      {moving ? (
        <MoveDialog
          key={moving.testId}
          series={series}
          row={moving}
          onClose={() => setMoving(null)}
          onMoved={held}
        />
      ) : null}
    </FormSection>
  );
}

const UNTITLED = 'Untitled test';

function testColumns(
  options: Readonly<{
    canWrite: boolean;
    onMoving: (row: SeriesTestRow) => void;
  }>,
): DataTableColumn<SeriesTestRow>[] {
  const { canWrite, onMoving } = options;

  return [
    { key: 'order', header: '#', numeric: true, cell: (row) => row.order ?? '—' },
    {
      key: 'title',
      header: 'Test',
      className: 'w-full max-w-0 font-medium',
      cell: (row) => (
        <Link to={ROUTES.TEST(row.testId)} className={linkVariants()}>
          <TruncatedText>{row.title ?? UNTITLED}</TruncatedText>
        </Link>
      ),
    },
    { key: 'questions', header: 'Questions', numeric: true, cell: (row) => row.totalQuestions },
    {
      key: 'duration',
      header: 'Duration',
      numeric: true,
      cell: (row) => durationLabel(row.durationSec),
    },
    {
      key: 'opens',
      header: 'Opens',
      className: 'max-w-56',
      cell: (row) => <TruncatedText>{opensLabel(row.unlockAt)}</TruncatedText>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <TestStatusBadges status={row.status} isLocked={row.isLocked} />,
    },
    { key: 'sat', header: 'Sat', numeric: true, cell: (row) => row.attemptCount },
    {
      key: 'actions',
      className: 'text-right',
      // Unsat-only: a sat test's series is part of the record.
      cell: (row) =>
        canWrite && row.attemptCount === 0 ? (
          <RowActions label={`Actions for ${row.title ?? UNTITLED}`}>
            <DropdownMenuItem onSelect={() => onMoving(row)}>
              <ArrowRightLeft aria-hidden />
              Move to another series
            </DropdownMenuItem>
          </RowActions>
        ) : null,
    },
  ];
}

/** Every test here is judged the way this series is, so the row's mode is the series' own. */
function MoveDialog({
  series,
  row,
  onClose,
  onMoved,
}: Readonly<{
  series: TestSeriesSummary;
  row: SeriesTestRow;
  onClose: () => void;
  onMoved: (next: SeriesTestRow[]) => void;
}>) {
  const queryClient = useQueryClient();
  const form = useForm<MoveFormValues>({ defaultValues: { testSeriesId: '' } });
  const [chosen, setChosen] = useState<ChosenSeries>(NO_SERIES);
  // Picked, not yet moved: choosing a series and agreeing to lose the old one are two questions.
  const [confirming, setConfirming] = useState<ChosenSeries | null>(null);

  const move = useMutation({
    meta: { success: 'Test moved.' },
    mutationFn: (testSeriesId: string) =>
      api.admin.tests.moveToSeries(row.testId, { testSeriesId }),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
      onMoved(await api.admin.testSeries.tests(series.id));
    },
    onError: (error) => {
      setConfirming(null);
      applyFieldErrors(error, form.setError, ['testSeriesId']);
    },
  });

  /** Refused here rather than at the server, so the confirm never promises a move that cannot happen. */
  const choose = (next: ChosenSeries) => {
    setChosen(next);
    form.setValue('testSeriesId', next.id, { shouldDirty: true });
    const issue =
      next.id === ''
        ? null
        : seriesModeMismatch(next.name, next.evaluationMode, series.evaluationMode);
    if (issue) form.setError('testSeriesId', { type: 'validate', message: issue });
    else form.clearErrors('testSeriesId');
  };

  return (
    <>
      <FormDialog
        open={confirming === null}
        onOpenChange={(open) => !open && onClose()}
        form={form}
        onSubmit={() => chosen.id !== '' && setConfirming(chosen)}
        title={`Move ${row.title ?? 'this test'} to another series`}
        description={`It is offered through ${series.name} today. A test is judged the way its series is, so it can only move to another ${EVALUATION_MODE_LABELS[series.evaluationMode]} series.`}
        submitLabel="Choose it"
        loading={move.isPending}
      >
        <FormField form={form} name="testSeriesId" label="Series">
          {(control) => (
            <TestSeriesPicker
              id={control.id}
              value={chosen.id}
              selectedLabel={chosen.name || undefined}
              placeholder="Choose a series"
              clearable={false}
              forExamStageId={series.examStageId ?? undefined}
              onChange={choose}
            />
          )}
        </FormField>
      </FormDialog>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Move ${row.title ?? 'this test'} to ${confirming?.name ?? ''}?`}
        description={`Students reached through ${series.name} stop being offered it, and students reached through ${confirming?.name ?? ''} start. Its paper and its opening time are untouched.`}
        confirmLabel="Move it"
        loading={move.isPending}
        onConfirm={() => confirming && move.mutate(confirming.id)}
      />
    </>
  );
}
