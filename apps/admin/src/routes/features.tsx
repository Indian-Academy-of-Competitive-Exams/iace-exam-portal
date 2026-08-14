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
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { api } from '../lib/api';
import { FEATURES_QUERY_KEY } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

const NEW_FEATURE_FIELDS = ['key', 'description'] as const;

/**
 * Register the sectors of the product that can be granted.
 *
 * The key IS the name — one value, so the two can never disagree about what a
 * feature is called — and it is typed, not chosen: the set is open, and a super
 * admin adds sectors as the product grows. It is normalised rather than
 * rejected, so "student management" becomes STUDENT_MANAGEMENT and a key that
 * differs only in case or spacing is impossible instead of merely reported.
 *
 * Nothing is seeded. A key with no row here grants nobody anything, which is
 * the safe direction to fail. The keys the code already checks are offered as
 * suggestions, because those are the ones that gate something today — a key
 * outside that list is valid and simply gates nothing until a module uses it.
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
  /** Code-known keys with no row yet — the ones that gate something today. */
  const suggested = FEATURE_KEY_VALUES.filter(
    (key) => !registered.some((feature) => feature.key === key),
  );

  const columns = useMemo<DataTableColumn<Feature>[]>(
    () => [
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
    ],
    [],
  );

  return (
    <SuperAdminOnly title="Features">
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

      {suggested.length > 0 && !features.isPending ? (
        <Alert variant="info" className="mb-5">
          <span>
            Not registered yet, and the code already checks {suggested.length === 1 ? 'it' : 'them'}
            : <b>{suggested.join(', ')}</b>. Until registered, nobody can be granted{' '}
            {suggested.length === 1 ? 'it' : 'them'}.
          </span>
        </Alert>
      ) : null}

      {creating ? (
        <NewFeatureCard
          suggested={suggested}
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
  suggested,
  onDone,
  onCancel,
}: Readonly<{ suggested: readonly string[]; onDone: () => void; onCancel: () => void }>) {
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
          The key is the name. Typed in any case and normalised to SCREAMING_SNAKE_CASE, so one
          sector can only ever be spelled one way. Both permission levels are created with it, so a
          grant is never blocked by a missing row.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField
            form={form}
            name="key"
            label="Feature key"
            hint={
              suggested.length > 0 ? `The code checks: ${suggested.join(', ')}` : 'e.g. REPORTING'
            }
            className="min-w-64 flex-1"
          >
            {(control) => (
              <Input
                {...control}
                list="feature-key-suggestions"
                className="uppercase placeholder:normal-case"
                placeholder="STUDENT_MANAGEMENT"
                autoFocus
              />
            )}
          </FormField>
          {/* Suggestions, not a closed list: typing a key the code has never
              heard of is allowed and is how a new sector starts. */}
          <datalist id="feature-key-suggestions">
            {suggested.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>

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
