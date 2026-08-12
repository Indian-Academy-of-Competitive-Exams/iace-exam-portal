import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { createGroupSchema, type CreateGroupInput, type GroupSummary } from '@iace/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';

const NEW_BATCH_FIELDS = ['name', 'branch'] as const;

export function BatchesPage() {
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const batches = useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: () => api.admin.groups.list({ pageSize: 100 }),
  });

  return (
    <>
      <PageHeader
        title="Batches"
        description="The unit that grants access: a student reaches a test through the batch they are in."
        action={
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            New batch
          </Button>
        }
      />

      {creating ? (
        <NewBatchCard
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card className="p-4">
        {batches.error ? (
          <Alert variant="danger" className="mb-4">
            {bannerMessage(batches.error)}
          </Alert>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead numeric>Students</TableHead>
              <TableHead numeric>Test series</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.isPending ? (
              <TableEmpty colSpan={5}>Loading…</TableEmpty>
            ) : batches.data?.items.length ? (
              batches.data.items.map((batch) => <BatchRow key={batch.id} batch={batch} />)
            ) : (
              <TableEmpty colSpan={5}>
                No batches yet. Create one before adding students.
              </TableEmpty>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function NewBatchCard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const form = useForm<CreateGroupInput>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { name: '', branch: '' },
  });

  const create = useMutation({
    mutationFn: (values: CreateGroupInput) => api.admin.groups.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_BATCH_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New batch</CardTitle>
        <CardDescription>
          Name it the way the branch refers to it — that is what admins will search for.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-start gap-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <div className="min-w-56 flex-1">
            <Field htmlFor="name" label="Batch name" error={form.formState.errors.name?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('name')}
                  placeholder="SSC CGL Morning"
                  autoFocus
                />
              )}
            </Field>
          </div>
          <div className="min-w-48 flex-1">
            <Field htmlFor="branch" label="Branch" error={form.formState.errors.branch?.message}>
              {(control) => (
                <Input {...control} {...form.register('branch')} placeholder="Ameerpet" />
              )}
            </Field>
          </div>

          <div className="flex gap-2 pt-[26px]">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Create
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>

          {create.error ? (
            <div className="w-full">
              <Alert variant="danger">{bannerMessage(create.error, NEW_BATCH_FIELDS)}</Alert>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function BatchRow({ batch }: { batch: GroupSummary }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.admin.groups.remove(batch.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] }),
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setConfirming(false),
  });

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          {/* Members are the student list filtered — the same screen, not a copy. */}
          <Link
            to={`${ROUTES.STUDENTS}?groupId=${batch.id}`}
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {batch.name}
          </Link>
        </TableCell>
        <TableCell className="text-muted-foreground">{batch.branch ?? '—'}</TableCell>
        <TableCell numeric>{batch.studentCount}</TableCell>
        <TableCell numeric>{batch.testSeriesCount}</TableCell>
        <TableCell className="text-right">
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Yes, delete
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${batch.name}`}
              onClick={() => {
                // Clear the last refusal: it described the batch as it was
                // before the admin went and moved the students.
                remove.reset();
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </TableCell>
      </TableRow>

      {remove.error ? (
        <tr>
          <TableCell colSpan={5} className="pt-0">
            {/* The server refuses while students or a series still depend on it,
                and its message says what to do first. */}
            <Alert variant="danger">{bannerMessage(remove.error)}</Alert>
          </TableCell>
        </tr>
      ) : null}
    </>
  );
}
