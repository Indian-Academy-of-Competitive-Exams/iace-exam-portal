import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { AppException, EXPORT_KINDS, type TestSeriesDetail } from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  EmptyState,
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  Card,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  toast,
  type FormPanelTab,
} from '@iace/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES, seriesQueryKey } from '../../lib/constants';
import { type StageChoice } from '../../components/exam-picker';
import { ExportButton } from '../../components/export-button';
import {
  SERIES_TAB,
  SERVER_FIELDS,
  bodyOf,
  valuesOf,
  type SeriesFormValues,
  type SeriesTab,
} from './test-series-detail';
import { SeriesBasics } from './test-series-basics';
import { SeriesAccess } from './test-series-access';
import { SeriesTests } from './test-series-tests';
import { BranchSchedule } from './test-series-branches';

/** One series in four views: Details and Access are halves of one form, Tests and Branches save themselves. */

export function TestSeriesFormPage() {
  const { id } = useParams();
  const existing = id !== undefined;
  const seriesId = id ?? '';

  const series = useQuery({
    queryKey: seriesQueryKey(seriesId),
    queryFn: () => api.admin.testSeries.detail(seriesId),
    enabled: existing,
  });

  // The form has a known shape, so it is drawn and held rather than spun at.
  if (existing && series.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={9} />
        </Card>
      </div>
    );
  }

  if (existing && !series.data) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this series"
        onRetry={series.refetch}
      />
    );
  }

  // Mounted only once the saved series is here, so a refetch cannot throw away a half-typed edit.
  return <SeriesEditor key={seriesId} detail={series.data ?? null} />;
}

function SeriesEditActions({
  existing,
  saving,
  onCancel,
}: Readonly<{ existing: boolean; saving: boolean; onCancel: () => void }>) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" loading={saving}>
        {existing ? 'Save series' : 'Create series'}
      </Button>
    </>
  );
}

/** Both halves of the turnout in one value: the cohort, and how much of it has sat anything. */
function turnoutOf(detail: TestSeriesDetail): string {
  const reached = detail.reachedCount.toLocaleString('en-IN');
  return `${detail.satCount.toLocaleString('en-IN')} of ${reached} students have sat a test`;
}

function seriesTitle(detail: TestSeriesDetail | null, isEditing: boolean): string {
  if (!detail) return 'New test series';
  return isEditing ? `Edit ${detail.name}` : detail.name;
}

/** The picker hands back only an id, so what the stage is CALLED has to be kept as it is chosen. */
const stageOf = (detail: TestSeriesDetail | null): StageChoice | null =>
  detail?.examStage
    ? { examCode: detail.examStage.examCode, stageName: detail.examStage.name }
    : null;

/** Every field the server can refuse is on the one form tab, so a refusal only has to open it. */
function refusesTheForm(error: unknown): boolean {
  const fieldErrors = AppException.is(error) ? error.fieldErrors : undefined;
  return fieldErrors !== undefined && SERVER_FIELDS.some((field) => fieldErrors[field]);
}

function SeriesEditor({ detail }: Readonly<{ detail: TestSeriesDetail | null }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  // A new series opens ready to type; one that already exists opens read-only.
  const [isEditing, setIsEditing] = useState(!existing);
  const [tab, setTab] = useState<SeriesTab>(SERIES_TAB.DETAILS);

  const form = useForm<SeriesFormValues>({ defaultValues: valuesOf(detail) });

  const save = useMutation({
    // Silent: the form's own banner and fields say what went wrong, so a toast would say it twice.
    meta: { silent: true },
    mutationFn: (values: SeriesFormValues) =>
      detail
        ? api.admin.testSeries.update(detail.id, bodyOf(values))
        : api.admin.testSeries.create(bodyOf(values)),
    onSuccess: async (saved) => {
      toast.success(existing ? 'Series saved.' : 'Series created.');
      await queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.TEST_SERIES,
        refetchType: 'none',
      });
      queryClient.setQueryData(seriesQueryKey(saved.id), saved);
      if (!existing) return navigate(ROUTES.TEST_SERIES_DETAIL(saved.id));
      // The saved values become the ones Cancel returns to; without this the next Save undoes this one.
      form.reset(valuesOf(saved));
      setIsEditing(false);
    },
    onError: (error) => {
      applyFieldErrors(error, form.setError, SERVER_FIELDS);
      if (refusesTheForm(error)) setTab(SERIES_TAB.DETAILS);
    },
  });

  const [stage, setStage] = useState(() => stageOf(detail));
  const banner = bannerMessage(save.error, SERVER_FIELDS);

  /** A new series has nowhere to fall back to, so Cancel leaves; an existing one returns to itself. */
  const cancel = () => {
    if (!existing) return navigate(ROUTES.TESTS);
    form.reset(valuesOf(detail));
    save.reset();
    setStage(stageOf(detail));
    setIsEditing(false);
  };

  const title = seriesTitle(detail, isEditing);

  const items: FormPanelTab[] = [
    {
      value: SERIES_TAB.DETAILS,
      label: 'Access & details',
      content: (
        <>
          {/* Access first: the name is suggested FROM the stage and the kind, so it cannot come before them. */}
          <SeriesAccess form={form} detail={detail} onPickStage={setStage} />
          <SeriesBasics form={form} stage={stage} />
        </>
      ),
    },
    // Both on every saved series, whatever its kind: a tab that comes and goes reads as a fault.
    ...(detail
      ? [
          {
            value: SERIES_TAB.TESTS,
            label: 'Tests',
            standalone: true,
            content: <SeriesTests series={detail} />,
          },
          {
            value: SERIES_TAB.BRANCHES,
            label: 'Branches',
            standalone: true,
            content: <BranchSchedule series={detail} />,
          },
        ]
      : []),
  ];

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      tabs={{ value: tab, onValueChange: (next) => setTab(next as SeriesTab), items }}
      footer={
        isEditing ? (
          <SeriesEditActions existing={existing} saving={save.isPending} onCancel={cancel} />
        ) : undefined
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={existing ? [{ label: title }] : []} />}
            title={title}
            meta={detail ? turnoutOf(detail) : undefined}
            action={
              <div className="flex items-center gap-3">
                {detail ? (
                  <ExportButton
                    label="Export grants"
                    kind={EXPORT_KINDS.SERIES_GRANTS}
                    download={() => api.admin.testSeries.grantsExport(detail.id)}
                  />
                ) : null}
                {isEditing ? null : (
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    <Pencil aria-hidden />
                    Edit series
                  </Button>
                )}
              </div>
            }
          />

          {banner ? <Alert variant="danger">{banner}</Alert> : null}
        </>
      }
    />
  );
}
