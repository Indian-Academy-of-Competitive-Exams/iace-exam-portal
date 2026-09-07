import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { AppException, TEST_SERIES_KIND, type TestSeriesSummary } from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
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
  FIELD_TAB,
  SERIES_TAB,
  SERVER_FIELDS,
  bodyOf,
  seriesKey,
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
    return <Alert variant="danger">Could not load this series.</Alert>;
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

/** The tab carrying the first field the server refused, so the refusal is never on a hidden pane. */
function refusedTab(error: unknown): SeriesTab | null {
  const fieldErrors = AppException.is(error) ? error.fieldErrors : undefined;
  if (!fieldErrors) return null;
  const first = SERVER_FIELDS.find((field) => fieldErrors[field]);
  return first ? FIELD_TAB[first] : null;
}

function SeriesEditor({ detail }: Readonly<{ detail: TestSeriesSummary | null }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = detail !== null;
  // A new series opens ready to type; one that already exists opens read-only.
  const [isEditing, setIsEditing] = useState(!existing);
  const [tab, setTab] = useState<SeriesTab>(SERIES_TAB.BASICS);

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
      const refused = refusedTab(error);
      if (refused) setTab(refused);
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
      value: SERIES_TAB.BASICS,
      label: 'Basic details',
      content: <SeriesBasics form={form} detail={detail} stage={stage} />,
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
    {
      value: SERIES_TAB.ACCESS,
      label: 'Access',
      content: <SeriesAccess form={form} detail={detail} onPickStage={setStage} />,
    },
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
              isEditing ? undefined : (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil aria-hidden />
                  Edit series
                </Button>
              )
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
