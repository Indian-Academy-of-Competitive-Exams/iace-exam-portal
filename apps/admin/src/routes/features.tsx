import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, Plus } from 'lucide-react';
import {
  createFeatureSchema,
  FEATURE_KEY_VALUES,
  PERMISSION_LEVELS,
  type CreateFeatureInput,
  type Feature,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  PageHeader,
  Select,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { api } from '../lib/api';
import { FEATURES_QUERY_KEY } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

const NEW_FEATURE_FIELDS = ['key', 'name', 'description'] as const;

/**
 * Register the sectors of the product that can be granted.
 *
 * Nothing is seeded, on purpose: a key with no row here grants nobody anything,
 * which is the safe direction to fail. The key is chosen from the canonical
 * list rather than typed, because a free-text key is a key no controller
 * checks — and a feature nothing gates is worse than no feature, since it looks
 * like protection.
 */
export function FeaturesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const features = useQuery({
    queryKey: FEATURES_QUERY_KEY,
    queryFn: () => api.admin.features.list(),
  });

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: FEATURES_QUERY_KEY }),
    [queryClient],
  );

  const registered = features.data ?? [];
  const unregistered = FEATURE_KEY_VALUES.filter(
    (key) => !registered.some((feature) => feature.key === key),
  );

  const columns = useMemo<DataTableColumn<Feature>[]>(
    () => [
      { key: 'key', header: 'Key', className: 'font-medium', cell: (f) => <code>{f.key}</code> },
      { key: 'name', header: 'Name', cell: (f) => f.name },
      {
        key: 'description',
        header: 'Description',
        cell: (f) => f.description ?? <span className="text-muted-foreground">—</span>,
      },
      {
        key: 'holders',
        header: 'Holders',
        cell: (f) => (
          <div className="flex gap-2">
            {[PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE].map((level) => (
              <Badge key={level} variant="neutral">
                {level}
                <span className="tabular-nums opacity-70">{f.grants[level]?.length ?? 0}</span>
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <SuperAdminOnly title="Features">
      <PageHeader
        title="Features"
        description="The sectors an admin can be granted. Registering one creates its READ and WRITE rows together."
        action={
          unregistered.length > 0 ? (
            <Button size="sm" onClick={() => setCreating((open) => !open)}>
              <Plus aria-hidden />
              Register feature
            </Button>
          ) : undefined
        }
      />

      {unregistered.length === 0 && !features.isPending ? (
        <Alert variant="info" className="mb-5">
          <span>
            Every key the code knows about is registered. A new one appears here once it is added to
            FEATURE_KEYS in the shared contracts.
          </span>
        </Alert>
      ) : null}

      {creating ? (
        <NewFeatureCard
          available={unregistered}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card className="p-4">
        <DataTable
          columns={columns}
          rows={registered}
          rowKey={(f) => f.id}
          isLoading={features.isPending}
          empty="No features registered yet — nobody can be granted anything until one is."
        />
      </Card>
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

function NewFeatureCard({
  available,
  onDone,
  onCancel,
}: Readonly<{ available: readonly string[]; onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateFeatureInput>({
    resolver: zodResolver(createFeatureSchema),
    defaultValues: { key: available[0] as CreateFeatureInput['key'], name: '', description: '' },
  });

  const create = useMutation({
    meta: { success: 'Feature registered.', fields: NEW_FEATURE_FIELDS },
    mutationFn: (values: CreateFeatureInput) => api.admin.features.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_FEATURE_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Register a feature</CardTitle>
        <CardDescription>
          Only keys the code actually checks are offered. Both permission levels are created with
          it, so a grant is never blocked by a missing row.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="key" label="Key" className="min-w-56 flex-1">
            {(control) => (
              <Select {...control}>
                {available.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField form={form} name="name" label="Name" className="min-w-48 flex-1">
            {(control) => <Input {...control} placeholder="Student management" />}
          </FormField>

          <FormField form={form} name="description" label="Description" className="min-w-64 flex-1">
            {(control) => <Input {...control} placeholder="What this covers" />}
          </FormField>

          <FormActions>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Register
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}
