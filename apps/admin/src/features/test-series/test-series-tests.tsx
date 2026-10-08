import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, BarChart3, CircleSlash, FileText, Plus, Power } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  TEST_STATUS,
  testIsOpen,
  type SeriesTestRow,
  type TestSeriesDetail,
  type TestSeriesSummary,
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
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { TestStatusBadges } from '../../components/test-status-badges';
import { durationLabel, opensLabel } from '../../lib/duration';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { NO_SERIES, TestSeriesPicker, type ChosenSeries } from '../../components/access-picker';
import { switchedOffering } from '../tests/test-offer-draft';
import { testsKey } from './test-series-detail';

interface MoveFormValues {
  testSeriesId: string;
}

/** The one field the server can refuse a move on, so it lands inline instead of also being toasted. */
const MOVE_FIELDS = ['testSeriesId'] as const;
export function SeriesTests({ series }: Readonly<{ series: TestSeriesDetail }>) {
  const queryClient = useQueryClient();
  const canWrite = useAuth().can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [moving, setMoving] = useState<SeriesTestRow | null>(null);
  const [switching, setSwitching] = useState<SeriesTestRow | null>(null);
  const columns = useMemo(
    () =>
      testColumns({
        canWrite,
        reached: series.reachedCount,
        onMoving: setMoving,
        onSwitching: setSwitching,
      }),
    [canWrite, series.reachedCount],
  );

  const tests = useQuery({
    queryKey: testsKey(series.id),
    queryFn: () => api.admin.testSeries.tests(series.id),
  });

  // Both series' lists and counts move, and the test's own record names its new series.
  const moved = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
  };

  return (
    <FormSection title="Tests">
      {canWrite ? (
        <div className="flex justify-end">
          <Button size="sm" asChild>
            {/* The series goes with it, so the builder opens knowing it and often the stage. */}
            <Link to={`${ROUTES.TEST_NEW}?series=${series.id}`}>
              <Plus aria-hidden />
              New test
            </Link>
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={tests.data ?? []}
        rowKey={(row) => row.testId}
        isLoading={tests.isLoading}
        isError={tests.isError}
        onRetry={tests.refetch}
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
          onMoved={moved}
        />
      ) : null}

      {switching ? (
        <StatusDialog
          key={switching.testId}
          series={series}
          row={switching}
          onClose={() => setSwitching(null)}
          onSaved={moved}
        />
      ) : null}
    </FormSection>
  );
}

const UNTITLED = 'Untitled test';

function testColumns(
  options: Readonly<{
    canWrite: boolean;
    reached: number;
    onMoving: (row: SeriesTestRow) => void;
    onSwitching: (row: SeriesTestRow) => void;
  }>,
): DataTableColumn<SeriesTestRow>[] {
  const { canWrite, reached, onMoving, onSwitching } = options;

  return [
    { key: 'order', header: '#', numeric: true, cell: (row) => row.order ?? '—' },
    {
      key: 'title',
      header: 'Test',
      className: 'max-w-[18rem] font-medium',
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
      cell: (row) => <TestStatusBadges status={row.status} finalizedAt={row.finalizedAt} />,
    },
    {
      key: 'sat',
      header: 'Sat',
      numeric: true,
      className: 'whitespace-nowrap',
      cell: (row) =>
        `${row.attemptCount.toLocaleString('en-IN')} / ${reached.toLocaleString('en-IN')}`,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => (
        <RowActions label={`Actions for ${row.title ?? UNTITLED}`}>
          <DropdownMenuItem asChild>
            <Link to={ROUTES.TEST_ANALYTICS(row.testId)}>
              <BarChart3 aria-hidden />
              Analytics
            </Link>
          </DropdownMenuItem>
          {/* Left out rather than offered and refused: the paper waits on the source. */}
          {row.paperSource ? (
            <DropdownMenuItem asChild>
              <Link to={ROUTES.TEST_PAPER(row.testId)}>
                <FileText aria-hidden />
                Paper
              </Link>
            </DropdownMenuItem>
          ) : null}
          {/* Unsat-only: a sat test's series is part of the record. */}
          {canWrite && row.attemptCount === 0 ? (
            <DropdownMenuItem onSelect={() => onMoving(row)}>
              <ArrowRightLeft aria-hidden />
              Move to another series
            </DropdownMenuItem>
          ) : null}
          {/* A draft has never been offered, and its first offer is the builder's: it freezes the paper. */}
          {canWrite && row.status !== TEST_STATUS.DRAFT ? (
            <DropdownMenuItem
              destructive={row.status === TEST_STATUS.ACTIVE}
              onSelect={() => onSwitching(row)}
            >
              {row.status === TEST_STATUS.ACTIVE ? (
                <CircleSlash aria-hidden />
              ) : (
                <Power aria-hidden />
              )}
              {row.status === TEST_STATUS.ACTIVE ? 'Make inactive' : 'Make active'}
            </DropdownMenuItem>
          ) : null}
        </RowActions>
      ),
    },
  ];
}

/** Taking it away and bringing it back are not the same question, so they are not the same words. */
function statusQuestion(row: SeriesTestRow, series: TestSeriesDetail) {
  const title = row.title ?? UNTITLED;
  const students = plural(series.reachedCount, 'student');

  if (row.status === TEST_STATUS.ACTIVE) {
    // In an ordered series the tests behind it wait only on what is active, which nobody sees from here.
    const order = series.sequentialTests
      ? ' The tests after it in the order stop waiting on it.'
      : '';
    return {
      title: `Make ${title} inactive?`,
      description: `It leaves the list of the ${students} reached through ${series.name} at once, and nobody can start it. Sittings already made keep their results, and one in progress is not stopped.${order}`,
      confirmLabel: 'Make inactive',
      destructive: true,
      success: 'Test made inactive.',
    };
  }

  const from = testIsOpen(row.unlockAt, new Date())
    ? 'from now'
    : `from ${opensLabel(row.unlockAt)}`;
  return {
    title: `Make ${title} active?`,
    description: `The ${students} reached through ${series.name} can sit it ${from}, on the paper it was frozen with.`,
    confirmLabel: 'Make active',
    destructive: false,
    success: 'Test made active.',
  };
}

const MOVED_ELSEWHERE =
  'This test has moved to another series since this list was read. Nothing was changed.';

/** The test's own switch, off the list: the one thing that decides whether a student can sit it. */
function StatusDialog({
  series,
  row,
  onClose,
  onSaved,
}: Readonly<{
  series: TestSeriesDetail;
  row: SeriesTestRow;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const question = statusQuestion(row, series);

  const save = useMutation({
    meta: { success: question.success },
    // The Offer step's own write, so there is still one road to an offered test: read it, flip the one field.
    mutationFn: async () => {
      const detail = await api.admin.tests.detail(row.testId);
      // The confirm named this series' students, so a test since moved out of it is not what was agreed to.
      if (detail.testSeriesId !== series.id) {
        throw new AppException(ErrorCodes.CONFLICT, MOVED_ELSEWHERE);
      }
      return api.admin.tests.saveOffering(
        row.testId,
        switchedOffering(detail, row.status !== TEST_STATUS.ACTIVE),
      );
    },
    // Refused or not, the row is re-read: a refusal means the list was stale, and it must not be clickable again.
    onSettled: () => {
      onClose();
      onSaved();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={question.destructive}
      loading={save.isPending}
      title={question.title}
      description={question.description}
      confirmLabel={question.confirmLabel}
      onConfirm={() => save.mutate()}
    />
  );
}

function MoveDialog({
  series,
  row,
  onClose,
  onMoved,
}: Readonly<{
  series: TestSeriesSummary;
  row: SeriesTestRow;
  onClose: () => void;
  onMoved: () => void;
}>) {
  const form = useForm<MoveFormValues>({ defaultValues: { testSeriesId: '' } });
  const [chosen, setChosen] = useState<ChosenSeries>(NO_SERIES);
  // Picked, not yet moved: choosing a series and agreeing to lose the old one are two questions.
  const [confirming, setConfirming] = useState<ChosenSeries | null>(null);

  const move = useMutation({
    meta: { success: 'Test moved.', fields: MOVE_FIELDS },
    mutationFn: (testSeriesId: string) =>
      api.admin.tests.moveToSeries(row.testId, { testSeriesId, expectedVersion: row.version }),
    onSuccess: () => {
      onClose();
      onMoved();
    },
    onError: (error) => {
      setConfirming(null);
      applyFieldErrors(error, form.setError, MOVE_FIELDS);
      // Refused because the row is out of date: the list is read again rather than left to be refused twice.
      if (AppException.is(error) && error.code === ErrorCodes.CONFLICT) {
        onClose();
        onMoved();
      }
    },
  });

  /** A new pick clears whatever the server refused the last one with. */
  const choose = (next: ChosenSeries) => {
    setChosen(next);
    form.setValue('testSeriesId', next.id, { shouldDirty: true });
    form.clearErrors('testSeriesId');
  };

  return (
    <>
      <FormDialog
        open={confirming === null}
        onOpenChange={(open) => !open && onClose()}
        form={form}
        onSubmit={() => chosen.id !== '' && setConfirming(chosen)}
        title={`Move ${row.title ?? 'this test'} to another series`}
        description={`It is offered through ${series.name} today.`}
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
              forExamStageId={row.examStageId}
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
