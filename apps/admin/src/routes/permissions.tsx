import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import {
  PERMISSION_LEVELS,
  satisfiesLevel,
  type Admin,
  type Feature,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { Alert, Badge, Card, DataTable, PageHeader, Select, type DataTableColumn } from '@iace/ui';
import { api } from '../lib/api';
import { FEATURES_QUERY_KEY, PAGE_SIZE_FOR_PICKERS } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

const LEVELS = [PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE] as const;

/**
 * Who holds what.
 *
 * One feature at a time, with every admin listed against it, because that is
 * the question actually being asked — "who can touch students" far more often
 * than "what can this one person touch". The Admins screen answers the other
 * direction.
 *
 * A super admin is shown but not editable: they bypass every check, so granting
 * them a level would be a row that changes nothing, and offering the control
 * would imply otherwise.
 */
export function PermissionsPage() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<FeatureKey | ''>('');

  const features = useQuery({
    queryKey: FEATURES_QUERY_KEY,
    queryFn: () => api.admin.features.list(),
  });
  const admins = useQuery({
    queryKey: ['admin', 'admins', 'all'],
    // Everyone, because this screen is about assignment rather than browsing.
    queryFn: () =>
      api.admin.admins.list({ page: 1, pageSize: PAGE_SIZE_FOR_PICKERS, activeOnly: 'true' }),
  });

  const registered = features.data ?? [];
  const selected = registered.find((f) => f.key === selectedKey) ?? registered[0];

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: FEATURES_QUERY_KEY }),
    [queryClient],
  );

  const columns = useMemo<DataTableColumn<Admin>[]>(
    () => [
      { key: 'email', header: 'Admin', className: 'font-medium', cell: (a) => a.email },
      { key: 'name', header: 'Name', cell: (a) => a.fullName ?? '—' },
      {
        key: 'level',
        header: 'Access',
        cell: (a) =>
          selected ? <LevelCell admin={a} feature={selected} onChanged={refresh} /> : null,
      },
    ],
    [selected, refresh],
  );

  return (
    <SuperAdminOnly title="Permissions">
      <PageHeader
        title="Permissions"
        description="Grant an admin READ or WRITE on a feature. WRITE covers create, update and delete, and always includes READ."
      />

      {registered.length === 0 && !features.isPending ? (
        <Alert variant="warning" className="mb-5">
          <span>
            No features are registered, so there is nothing to grant. Register one on the Features
            screen first.
          </span>
        </Alert>
      ) : null}

      {registered.length > 0 ? (
        <Card className="mb-5 p-4">
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Feature</span>
            <Select
              className="max-w-xs"
              value={selected?.key ?? ''}
              onChange={(event) => setSelectedKey(event.target.value as FeatureKey)}
              aria-label="Feature"
            >
              {registered.map((feature) => (
                <option key={feature.id} value={feature.key}>
                  {feature.key}
                </option>
              ))}
            </Select>
          </label>
        </Card>
      ) : null}

      <Card className="p-4">
        <DataTable
          columns={columns}
          rows={admins.data?.items ?? []}
          rowKey={(a) => a.id}
          isLoading={admins.isPending || features.isPending}
          empty="No active admins."
        />
      </Card>
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

/** The level this admin currently holds on this feature, from the grant lists. */
function currentLevel(admin: Admin, feature: Feature): PermissionLevel | undefined {
  if (feature.grants[PERMISSION_LEVELS.WRITE]?.includes(admin.id)) return PERMISSION_LEVELS.WRITE;
  if (feature.grants[PERMISSION_LEVELS.READ]?.includes(admin.id)) return PERMISSION_LEVELS.READ;
  return undefined;
}

function LevelCell({
  admin,
  feature,
  onChanged,
}: Readonly<{ admin: Admin; feature: Feature; onChanged: () => void }>) {
  const held = currentLevel(admin, feature);

  const change = useMutation({
    meta: { success: 'Access updated.' },
    mutationFn: async (next: PermissionLevel | '') => {
      // Revoke whatever is held before granting, so the two levels can never
      // both be set — the server resolves that to WRITE, but a row that says
      // one thing and a screen that says another is its own bug.
      if (held) {
        await api.admin.features.revoke({
          featureKey: feature.key,
          level: held,
          adminId: admin.id,
        });
      }
      if (next !== '') {
        await api.admin.features.grant({
          featureKey: feature.key,
          level: next,
          adminId: admin.id,
        });
      }
    },
    onSuccess: onChanged,
  });

  if (admin.isSuperAdmin) {
    return (
      <Badge variant="primary">
        <Check aria-hidden />
        Everything (bypass)
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        className="max-w-40"
        value={held ?? ''}
        disabled={change.isPending}
        aria-label={`Access for ${admin.email}`}
        onChange={(event) => change.mutate(event.target.value as PermissionLevel | '')}
      >
        <option value="">No access</option>
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </Select>

      {change.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      ) : null}

      {held === undefined && !change.isPending ? (
        <X className="size-4 text-muted-foreground" aria-hidden />
      ) : null}

      {/* Says out loud what WRITE implies, so nobody grants both. */}
      {satisfiesLevel(held, PERMISSION_LEVELS.READ) && held === PERMISSION_LEVELS.WRITE ? (
        <span className="text-xs text-muted-foreground">includes read</span>
      ) : null}
    </div>
  );
}
