import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  STUDENT_SERIES_SOURCE,
  type StudentDetail,
  type StudentSeriesAccess,
} from '@iace/contracts';
import {
  BadgeList,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  Field,
  FormSection,
  RowActions,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { NO_SERIES, TestSeriesPicker, type ChosenSeries } from '../components/access-picker';
import { api } from '../lib/api';
import { WHEN_FORMATTER } from '../lib/audit-vocabulary';
import { QUERY_KEYS, SERIES_SOURCE_LABELS } from '../lib/constants';

const seriesKey = (studentId: string) => [...QUERY_KEYS.STUDENT, studentId, 'series'] as const;

function seriesColumns(
  busy: boolean,
  onRevoke: (row: StudentSeriesAccess) => void,
): DataTableColumn<StudentSeriesAccess>[] {
  return [
    {
      key: 'series',
      header: 'Series',
      className: 'max-w-72',
      cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
    },
    {
      key: 'sources',
      header: 'Reached by',
      className: 'max-w-56',
      cell: (row) => (
        <BadgeList items={row.sources} label={(source) => SERIES_SOURCE_LABELS[source]} max={2} />
      ),
    },
    {
      key: 'granted',
      header: 'Granted',
      className: 'max-w-48',
      cell: (row) => (
        <TruncatedText>
          {row.grantedAt ? WHEN_FORMATTER.format(new Date(row.grantedAt)) : null}
        </TruncatedText>
      ),
    },
    {
      key: 'actions',
      // Left out rather than disabled: there is no grant on an exam or program match to revoke.
      cell: (row) =>
        row.sources.includes(STUDENT_SERIES_SOURCE.GRANT) ? (
          <RowActions label={`Actions for ${row.name}`}>
            <DropdownMenuItem destructive disabled={busy} onSelect={() => onRevoke(row)}>
              <Trash2 aria-hidden />
              Revoke grant
            </DropdownMenuItem>
          </RowActions>
        ) : null,
    },
  ];
}

/** Capped: a student on many series must not push the fields above it off the page. */
function SeriesList({
  series,
  isLoading,
  isError,
  onRetry,
  busy,
  onRevoke,
}: Readonly<{
  series: readonly StudentSeriesAccess[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  busy: boolean;
  onRevoke: (row: StudentSeriesAccess) => void;
}>) {
  const columns = useMemo(() => seriesColumns(busy, onRevoke), [busy, onRevoke]);

  return (
    <DataTable
      columns={columns}
      rows={series}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      isError={isError}
      error="This student's series did not load."
      onRetry={onRetry}
      skeletonRows={3}
      scroll={{}}
      empty="Nothing reaches this student yet"
    />
  );
}

/** A grant is filed against the student either way; whether it OPENS anything is the series' switch. */
function grantConsequence(chosen: ChosenSeries): string {
  if (!chosen.isEnabled) {
    return `${chosen.name} is switched off, so this grant opens nothing yet — they reach its tests only once somebody switches the series on. It is one row for this one student and changes nothing for anybody else.`;
  }
  return `They reach every test in ${chosen.name} from now on, whatever their enrolments, programs or branch say. It is one row for this one student and changes nothing for anybody else.`;
}

/** Every series this student reaches, and the one direct grant an admin can add or take away. */
export function SeriesTab({ detail }: Readonly<{ detail: StudentDetail }>) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<ChosenSeries>(NO_SERIES);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<StudentSeriesAccess | null>(null);
  const studentId = detail.id;
  const name = detail.fullName ?? detail.mobile;

  const series = useQuery({
    queryKey: seriesKey(studentId),
    queryFn: () => api.admin.studentSeries.list(studentId),
  });

  // The picker asks the server what they do NOT reach, so a grant changes its answer too.
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: seriesKey(studentId) });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
  };

  const grant = useMutation({
    meta: { success: 'Series granted.' },
    mutationFn: () => api.admin.grants.create(studentId, { testSeriesId: chosen.id }),
    onSuccess: async () => {
      setGranting(false);
      setChosen(NO_SERIES);
      await refresh();
    },
    // Drop out of the confirm on failure, or it is left asking a question already answered.
    onError: () => setGranting(false),
  });

  const revoke = useMutation({
    meta: { success: 'Grant revoked.' },
    mutationFn: (testSeriesId: string) => api.admin.grants.remove(studentId, testSeriesId),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
    },
    onError: () => setRevoking(null),
  });

  const keepsItAnyway =
    revoking?.sources.some((source) => source !== STUDENT_SERIES_SOURCE.GRANT) ?? false;

  return (
    <FormSection title="Series">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field
            htmlFor="grantSeries"
            label="Series to grant"
            // ui-copy-ok: rule — why Grant is dead, which a disabled button cannot say
            hint={detail.isTestBlocked ? 'Lift the test block before granting.' : undefined}
            className="min-w-56 flex-1"
          >
            {({ id, 'aria-describedby': describedBy }) => (
              <TestSeriesPicker
                id={id}
                aria-describedby={describedBy}
                value={chosen.id}
                selectedLabel={chosen.name || undefined}
                notReachedBy={studentId}
                clearable
                placeholder="Choose a series"
                onChange={setChosen}
              />
            )}
          </Field>

          <Button
            type="button"
            variant="outline"
            disabled={chosen.id === '' || detail.isTestBlocked}
            loading={grant.isPending}
            onClick={() => setGranting(true)}
          >
            <Plus aria-hidden />
            Grant
          </Button>
        </div>

        <SeriesList
          series={series.data ?? []}
          isLoading={series.isLoading}
          isError={series.isError}
          onRetry={series.refetch}
          busy={revoke.isPending}
          onRevoke={setRevoking}
        />
      </div>

      {/* A grant is the one direct student-to-offering link in the model, so it is
          stated in full before it is written. */}
      <ConfirmDialog
        open={granting}
        onOpenChange={(open) => !open && setGranting(false)}
        loading={grant.isPending}
        title={`Grant ${chosen.name} to ${name}?`}
        description={grantConsequence(chosen)}
        confirmLabel="Grant series"
        onConfirm={() => grant.mutate()}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        destructive
        loading={revoke.isPending}
        title={`Revoke ${revoking?.name} from ${name}?`}
        description={
          keepsItAnyway
            ? `An enrolment or a program also reaches ${revoking?.name}, so they keep it and nothing they can sit changes. Only the direct grant is removed.`
            : `They lose this route to its tests straight away. Attempts already made and their results are kept.`
        }
        confirmLabel="Revoke grant"
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </FormSection>
  );
}
