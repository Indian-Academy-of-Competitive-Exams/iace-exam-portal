import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus } from 'lucide-react';
import {
  createFeatureSchema,
  featureKeyDraft,
  PERMISSION_LEVELS,
  type CreateFeatureInput,
  type Feature,
} from '@iace/contracts';
import {
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
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { api } from '../lib/api';
import { FEATURES_QUERY_KEY } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

const NEW_FEATURE_FIELDS = ['key', 'description'] as const;

/**
 * Registers the grantable sectors. The key IS the name, typed and normalised, so
 * a case- or space-different duplicate is impossible. Every feature is a peer; nothing is seeded.
 */
/** Built outside the component: `cell` is a render prop, not a component declaration. */
function featureColumns(): DataTableColumn<Feature>[] {
  return [
    {
      key: 'key',
      header: 'Feature',
      className: 'font-medium',
      cell: (f) => <code>{f.key}</code>,
    },
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
  ];
}

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

  const columns = useMemo(() => featureColumns(), []);

  const header = (
    <>
      <PageHeader
        title="Features"
        description="The sectors an admin can be granted. Registering one creates its READ and WRITE rows together."
        action={
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            Register feature
          </Button>
        }
      />

      {creating ? (
        <NewFeatureCard
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </>
  );

  return (
    <SuperAdminOnly title="Features">
      <TableFrame framed={!creating} header={header}>
        <DataTable
          columns={columns}
          rows={registered}
          rowKey={(f) => f.id}
          isLoading={features.isPending}
          empty="No features registered yet — nobody can be granted anything until one is."
        />
      </TableFrame>
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

function NewFeatureCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateFeatureInput>({
    resolver: zodResolver(createFeatureSchema),
    defaultValues: { key: '', description: '' },
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
          The key is the feature, and the key is its name. Typed in any case and normalised to
          SCREAMING_SNAKE_CASE, so one feature can only ever be spelled one way. Both permission
          levels are created with it, so a grant is never blocked by a missing row.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField
            form={form}
            name="key"
            label="Feature key"
            hint="Capitals and underscores — spaces become underscores as you type"
            className="min-w-64 flex-1"
          >
            {(control) => (
              <Input
                {...control}
                className="font-mono"
                placeholder="STUDENT_MANAGEMENT"
                autoFocus
                onChange={(event) => {
                  // Normalised in the field, not on submit, so they read the key they are creating.
                  const drafted = featureKeyDraft(event.currentTarget.value);
                  if (event.currentTarget.value !== drafted) event.currentTarget.value = drafted;
                  return control.onChange(event);
                }}
              />
            )}
          </FormField>

          <FormField form={form} name="description" label="Description" className="min-w-64 flex-1">
            {(control) => <Input {...control} placeholder="What this covers" />}
          </FormField>

          <FormActions>
            <Button type="submit" loading={create.isPending}>
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
