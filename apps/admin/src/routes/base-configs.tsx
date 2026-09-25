import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type BaseConfig,
  type BaseConfigDetail,
} from '@iace/contracts';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  ListView,
  PageHeader,
  TableFrame,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { ActiveStatus, RetireDeleteActions } from '../components/retire-delete-actions';
import { StageCell } from '../components/stage-cell';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES, TIMER_TEMPLATE_LABELS } from '../lib/constants';
import { durationLabel } from '../lib/duration';
import { useAuth } from '../providers/auth';
import { ExamMultiPicker } from '../components/exam-picker';

const CONFIG_FILTERS = [
  {
    key: 'q',
    kind: 'search',
    label: 'Search base configurations',
    placeholder: 'Search configurations by name',
    primary: true,
  },
  {
    key: 'examId',
    kind: 'customMulti',
    label: 'Filter by exam',
    primary: true,
    render: (control: ListFilterMultiControl) => <ExamMultiPicker {...control} />,
  },
] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function configColumns(canWrite: boolean, refresh: () => void): DataTableColumn<BaseConfig>[] {
  return [
    {
      key: 'name',
      header: 'Configuration',
      className: 'max-w-[20rem] font-medium',
      cell: (config) => (
        <Link to={ROUTES.BASE_CONFIG(config.id)} className={linkVariants()}>
          <TruncatedText>{config.name}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      cell: (config) => (
        <StageCell stage={{ examCode: config.examStage.exam.code, name: config.examStage.name }} />
      ),
    },
    {
      key: 'timer',
      header: 'Timing pattern',
      cell: (config) => (
        <span className="text-muted-foreground">{TIMER_TEMPLATE_LABELS[config.timerTemplate]}</span>
      ),
    },
    { key: 'status', header: 'Status', cell: (config) => <ConfigStatus config={config} /> },
    {
      key: 'questions',
      header: 'Questions',
      numeric: true,
      cell: (config) => config.totalQuestions,
    },
    { key: 'marks', header: 'Marks', numeric: true, cell: (config) => config.totalMarks },
    {
      key: 'duration',
      header: 'Duration',
      numeric: true,
      cell: (config) => durationLabel(config.durationSec),
    },
    { key: 'tests', header: 'Tests', numeric: true, cell: (config) => config.testCount },
    {
      key: 'actions',
      className: 'text-right',
      cell: (config) => (
        <ConfigRowActions config={config} canWrite={canWrite} onChanged={refresh} />
      ),
    },
  ];
}

// A stage's blueprints freeze at first finalize; a locked config only evolves by Clone, so Clone sits on the row, not a menu.
export function BaseConfigsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BASE_CONFIGS });
  }, [queryClient]);

  const columns = useMemo(() => configColumns(canWrite, refresh), [canWrite, refresh]);

  const configs = useListScreen({
    queryKey: QUERY_KEYS.BASE_CONFIGS,
    filters: CONFIG_FILTERS,
    toQuery: (values) => ({
      q: values.q || undefined,
      examId: values.examId,
    }),
    fetchPage: (params) => api.admin.baseConfigs.list(params),
  });

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Base configurations"
      action={
        canWrite ? (
          <Button size="sm" asChild>
            <Link to={ROUTES.BASE_CONFIG_NEW}>
              <Plus aria-hidden />
              New configuration
            </Link>
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <TableFrame header={header}>
      <ListView
        list={configs}
        filters={CONFIG_FILTERS}
        columns={columns}
        rowKey={(config) => config.id}
        empty={{
          title: 'No base configurations yet',
          hint: 'Build the first one. Every test hangs its shape off one.',
        }}
        emptyFiltered="No configurations match those filters"
      />
    </TableFrame>
  );
}

function ConfigStatus({ config }: Readonly<{ config: BaseConfig }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {config.isDefault ? <Badge variant="primary">Default</Badge> : null}
      {config.locked ? <Badge variant="warning">Locked</Badge> : null}
      <ActiveStatus isActive={config.isActive} />
    </span>
  );
}

/** Names what would refuse the delete, so the dialog is not a guess the server then corrects. */
function deleteDescription(config: BaseConfig): string {
  if (config.locked) {
    return `${config.name} is locked: a test built from it has already been sat, so deleting it will be refused. Retire it instead. It keeps its history and is simply no longer offered.`;
  }
  if (config.testCount > 0) {
    return `${plural(config.testCount, 'test')} inherit their shape from ${config.name}, and deleting it will be refused. Retire it instead. A retired config keeps everything it has and is simply no longer offered.`;
  }
  return `No test inherits from ${config.name} and none has been sat. Deleting it removes its sections too, and cannot be undone.`;
}

function ConfigRowActions({
  config,
  canWrite,
  onChanged,
}: Readonly<{ config: BaseConfig; canWrite: boolean; onChanged: () => void }>) {
  const navigate = useNavigate();
  const [cloning, setCloning] = useState(false);

  const clone = useMutation({
    meta: { success: 'Configuration cloned.' },
    mutationFn: () => api.admin.baseConfigs.clone(config.id, {}),
    onSuccess: (copy: BaseConfigDetail) => {
      setCloning(false);
      onChanged();
      // Cloning is only ever a step towards editing the copy, so it lands there.
      navigate(ROUTES.BASE_CONFIG(copy.id));
    },
    onError: () => setCloning(false),
  });

  if (!canWrite) return null;

  return (
    <>
      <RetireDeleteActions
        name={config.name}
        noun="configuration"
        isActive={config.isActive}
        canEdit={canWrite}
        resource={api.admin.baseConfigs}
        id={config.id}
        onChanged={onChanged}
        retireText={
          config.isActive
            ? `Nothing it already holds changes. ${plural(config.testCount, 'test')} built from it keep working exactly as now. What stops is new ones: this configuration will no longer be offered when anyone builds a test. Reactivating puts it back.`
            : 'The configuration is offered again when anyone builds a test. Nothing else changes.'
        }
        deleteText={deleteDescription(config)}
      >
        <DropdownMenuItem asChild>
          <Link to={ROUTES.BASE_CONFIG(config.id)}>
            <Pencil aria-hidden />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setCloning(true)}>
          <Copy aria-hidden />
          Clone
        </DropdownMenuItem>
      </RetireDeleteActions>

      {/* A clone is a new blueprint somebody else will find here, so it says what the copy starts as. */}
      <ConfirmDialog
        open={cloning}
        onOpenChange={setCloning}
        loading={clone.isPending}
        title={`Clone ${config.name}?`}
        description={`The copy carries every setting and all ${plural(config.totalQuestions, 'question')} of its sections as they stand now. It starts unlocked, is not the stage's default, and ${config.name} is left exactly as it is. You will land on the copy.`}
        confirmLabel="Clone configuration"
        onConfirm={() => clone.mutate()}
      />
    </>
  );
}
