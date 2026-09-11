import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { AppException, TEST_SERIES_KIND, type TestSeriesSummary } from '@iace/contracts';
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
  type FormPanelTab,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { type StageChoice } from '../components/exam-picker';
import {
  SERIES_TAB,
  SERVER_FIELDS,
  bodyOf,
  seriesKey,
  valuesOf,
  type SeriesFormValues,
  type SeriesTab,
} from './test-series-detail';
import { SeriesBasics } from './test-series-basics';
import { SeriesAccess, SeriesSwitch } from './test-series-access';
import { SeriesTests } from './test-series-tests';
import { BranchSchedule } from './test-series-branches';

/** One series in four views: Details and Access are halves of one form, Tests and Branches save themselves. */

export function TestSeriesFormPage() {
  const { id } = useParams();
  const existing = id !== undefined;
  const seriesId = id ?? '';

  const series = useQuery({
    queryKey: seriesKey(seriesId),
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

  if (existing && (series.error || !series.data)) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this series"
        onRetry={series.refetch}
      />
    );
  }

  // Mounted only once the saved series is here, so a refetch cannot throw away a half-typed edit.
  return <SeriesEditor detail={series.data ?? null} />;
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

function seriesTitle(detail: TestSeriesSummary | null, isEditing: boolean): string {
  if (!detail) return 'New test series';
  return isEditing ? `Edit ${detail.name}` : detail.name;
}

/** Every field the server can refuse is on the one form tab, so a refusal only has to open it. */
function refusesTheForm(error: unknown): boolean {
  const fieldErrors = AppException.is(error) ? error.fieldErrors : undefined;
  return fieldErrors !== undefined && SERVER_FIELDS.some((field) => fieldErrors[field]);
}

function SeriesEditor({ detail }: Readonly<{ detail: TestSeriesSummary | null }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  // A new series opens ready to type; one that already exists opens read-only.
  const [isEditing, setIsEditing] = useState(!existing);
  const [tab, setTab] = useState<SeriesTab>(SERIES_TAB.DETAILS);

  const form = useForm<SeriesFormValues>({ defaultValues: valuesOf(detail) });

  const save = useMutation({
    meta: { success: existing ? 'Series saved.' : 'Series created.', fields: SERVER_FIELDS },
    mutationFn: (values: SeriesFormValues) =>
      detail
        ? api.admin.testSeries.update(detail.id, bodyOf(values))
        : api.admin.testSeries.create(bodyOf(values)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_SERIES });
      queryClient.setQueryData(seriesKey(saved.id), saved);
      if (!existing) return navigate(ROUTES.TEST_SERIES_DETAIL(saved.id));
      setIsEditing(false);
    },
    onError: (error) => {
      applyFieldErrors(error, form.setError, SERVER_FIELDS);
      if (refusesTheForm(error)) setTab(SERIES_TAB.DETAILS);
    },
  });

  // The picker hands back only an id, so what the stage is CALLED has to be kept as it is chosen.
  const [stage, setStage] = useState<StageChoice | null>(
    detail?.examStage
      ? { examCode: detail.examStage.examCode, stageName: detail.examStage.name }
      : null,
  );
  const banner = bannerMessage(save.error, SERVER_FIELDS);

  /** A new series has nowhere to fall back to, so Cancel leaves; an existing one returns to itself. */
  const cancel = () => {
    if (!existing) return navigate(ROUTES.TESTS);
    form.reset();
    setIsEditing(false);
  };

  const title = seriesTitle(detail, isEditing);

  const items: FormPanelTab[] = [
    {
      value: SERIES_TAB.DETAILS,
      label: 'Details & access',
      content: (
        <>
          <SeriesBasics form={form} stage={stage} />
          <SeriesAccess form={form} detail={detail} onPickStage={setStage} />
        </>
      ),
    },
    ...(detail
      ? [
          {
            value: SERIES_TAB.TESTS,
            label: 'Tests',
            standalone: true,
            content: <SeriesTests series={detail} />,
          },
        ]
      : []),
    // The saved kind, not the chosen one: a series still carrying branches has to switch them off.
    ...(detail?.kind === TEST_SERIES_KIND.STANDARD
      ? [
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
            action={
              // The switch saves itself, so it belongs to the record and not to the form's Edit.
              <div className="flex items-center gap-3">
                {detail ? <SeriesSwitch series={detail} /> : null}
                {isEditing ? null : (
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                    <Pencil aria-hidden />
                    Edit series
                  </Button>
                )}
              </div>
            }
          />

          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    />
  );
}
