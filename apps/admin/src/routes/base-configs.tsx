import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type BaseConfig,
  type BaseConfigDetail,
} from '@iace/contracts';
import { useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  linkVariants,
  PageHeader,
  Pagination,
  plural,
  SearchInput,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, TIMER_TEMPLATE_LABELS } from '../lib/constants';
import { durationLabel } from '../lib/duration';
import { useAuth } from '../providers/auth';
import { useFilters } from '../lib/use-filters';
import { ExamPicker } from '../components/exam-picker';

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = ['q', 'examId'] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

const CONFIGS_KEY = ['admin', 'base-configs'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function configColumns(canWrite: boolean, refresh: () => void): DataTableColumn<BaseConfig>[] {
  return [
    {
      key: 'stage',
      header: 'Stage',
      cell: (config) => (
        <span className="flex flex-col">
          <span className="font-mono text-sm">{config.examStage.exam.code}</span>
          <span className="text-xs text-muted-foreground">{config.examStage.name}</span>
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Config',
      className: 'font-medium',
      cell: (config) => (
        <Link to={ROUTES.BASE_CONFIG(config.id)} className={linkVariants()}>
          {config.name}
        </Link>
      ),
    },
    {
      key: 'timer',
      header: 'Runs as',
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

/**
 * A stage's blueprints. The shape freezes at the first finalize of a test built from one, so the
 * way a locked config evolves is a clone — which is why Clone sits on the row, not in a menu.
 */
export function BaseConfigsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  const filters = useFilters<FilterKey>();
  const examId = filters.get('examId');

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CONFIGS_KEY });
  }, [queryClient]);

  const columns = useMemo(() => configColumns(canWrite, refresh), [canWrite, refresh]);

  const configs = useListQuery({
    queryKey: CONFIGS_KEY,
    filters: { q: filters.get('q') || undefined, examId: examId || undefined },
    fetchPage: (params) => api.admin.baseConfigs.list(params),
  });

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Base configs"
      description="A stage's blueprint: how long the paper runs, how it is navigated, and the sections it is made of. A test inherits that shape rather than restating it."
      action={
        canWrite ? (
          <Button size="sm" asChild>
            <Link to={ROUTES.BASE_CONFIG_NEW}>
              <Plus aria-hidden />
              New config
            </Link>
          </Button>
        ) : undefined
      }
    />
  );

  const toolbar = (
    <div className="mb-4 flex flex-wrap gap-3">
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search base configs"
          placeholder="Search configs by name"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>
      <div className="w-56">
        <ExamPicker
          aria-label="Filter by exam"
          value={examId}
          clearable
          onChange={(value) => filters.set({ examId: value })}
        />
      </div>
    </div>
  );

  return (
    <TableFrame header={header} toolbar={toolbar}>
      {/* "None match" and "there are none" are different facts, and telling an
          admin the wrong one sends them looking in the wrong place. */}
      <DataTable
        columns={columns}
        rows={configs.items}
        rowKey={(config) => config.id}
        isLoading={configs.isLoading}
        empty={
          filters.activeCount(ALL_FILTERS) > 0
            ? 'No configs match those filters.'
            : 'No base configs yet. Build the first one — every test hangs its shape off one.'
        }
        footer={configs.hasLoaded ? <Pagination {...configs.pagination} /> : null}
      />
    </TableFrame>
  );
}

function ConfigStatus({ config }: Readonly<{ config: BaseConfig }>) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {config.isDefault ? <Badge variant="primary">Default</Badge> : null}
      {config.locked ? <Badge variant="warning">Locked</Badge> : null}
      <Badge variant={config.isActive ? 'success' : 'neutral'}>
        {config.isActive ? 'Active' : 'Retired'}
      </Badge>
    </span>
  );
}

/** One question at a time: three booleans could render three dialogs at once. */
const CONFIG_CONFIRMS = {
  CLONE: 'clone',
  RETIRE: 'retire',
  DELETE: 'delete',
} as const;
type ConfigConfirm = (typeof CONFIG_CONFIRMS)[keyof typeof CONFIG_CONFIRMS];

/** Names what would refuse the delete, so the dialog is not a guess the server then corrects. */
function deleteDescription(config: BaseConfig): string {
  if (config.locked) {
    return `${config.name} is locked — a test built from it has already been sat — so deleting it will be refused. Retire it instead: it keeps its history and is simply no longer offered.`;
  }
  if (config.testCount > 0) {
    return `${plural(config.testCount, 'test')} inherit their shape from ${config.name}, and deleting it will be refused. Retire it instead — a retired config keeps everything it has and is simply no longer offered.`;
  }
  return `No test inherits from ${config.name} and none has been sat. Deleting it removes its sections too, and cannot be undone.`;
}

/**
 * The buttons only ask; the dialogs live with the mutations in `ConfigRowActions`.
 * A component, not a ternary, because the first state is "render nothing".
 */
function ConfigActions({
  config,
  canWrite,
  busy,
  onAsk,
}: Readonly<{
  config: BaseConfig;
  canWrite: boolean;
  busy: boolean;
  onAsk: (confirm: ConfigConfirm) => void;
}>) {
  if (!canWrite) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link to={ROUTES.BASE_CONFIG(config.id)}>
          <Pencil aria-hidden />
          Edit
        </Link>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(CONFIG_CONFIRMS.CLONE)}
      >
        <Copy aria-hidden />
        Clone
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(CONFIG_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {config.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onAsk(CONFIG_CONFIRMS.DELETE)}
      >
        <Trash2 aria-hidden />
        Delete
      </Button>
    </span>
  );
}

function ConfigRowActions({
  config,
  canWrite,
  onChanged,
}: Readonly<{ config: BaseConfig; canWrite: boolean; onChanged: () => void }>) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState<ConfigConfirm | null>(null);
  const close = () => setAsking(null);

  const clone = useMutation({
    meta: { success: 'Config cloned.' },
    mutationFn: () => api.admin.baseConfigs.clone(config.id, {}),
    onSuccess: (copy: BaseConfigDetail) => {
      close();
      onChanged();
      // Cloning is only ever a step towards editing the copy, so it lands there.
      navigate(ROUTES.BASE_CONFIG(copy.id));
    },
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${config.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.baseConfigs.update(config.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const remove = useMutation({
    meta: { success: `${config.name} deleted.` },
    mutationFn: () => api.admin.baseConfigs.remove(config.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const busy = clone.isPending || setActive.isPending || remove.isPending;

  return (
    <>
      <ConfigActions config={config} canWrite={canWrite} busy={busy} onAsk={setAsking} />

      {/* A clone is a new blueprint somebody else will find in this list, so it says
          exactly what the copy starts as. */}
      <ConfirmDialog
        open={asking === CONFIG_CONFIRMS.CLONE}
        onOpenChange={(open) => !open && close()}
        loading={clone.isPending}
        title={`Clone ${config.name}?`}
        description={`The copy carries every setting and all ${plural(config.totalQuestions, 'question')} of its sections as they stand now. It starts unlocked, is not the stage's default, and ${config.name} is left exactly as it is. You will land on the copy.`}
        confirmLabel="Clone config"
        onConfirm={() => clone.mutate()}
      />

      <ConfirmDialog
        open={asking === CONFIG_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={config.isActive ? `Retire ${config.name}?` : `Reactivate ${config.name}?`}
        description={
          config.isActive
            ? `Nothing it already holds changes — ${plural(config.testCount, 'test')} built from it keep working exactly as now. What stops is new ones: this config will no longer be offered when anyone builds a test. Reactivating puts it back.`
            : 'The config is offered again when anyone builds a test. Nothing else changes.'
        }
        confirmLabel={config.isActive ? 'Retire config' : 'Reactivate config'}
        onConfirm={() => setActive.mutate(!config.isActive)}
      />

      <ConfirmDialog
        open={asking === CONFIG_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${config.name}?`}
        description={deleteDescription(config)}
        confirmLabel="Delete config"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
