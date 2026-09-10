import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Power, Trash2, Upload } from 'lucide-react';
import {
  createEventSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateEventSchema,
  type CreateEventInput,
  type Event,
  type UpdateEventInput,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { useListScreen } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  Field,
  FormDialog,
  FormField,
  Input,
  linkVariants,
  ListView,
  plural,
  RowActions,
  Textarea,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { StudentMultiPicker } from '../components/access-picker';
import { QUERY_KEYS, ROUTES } from '../lib/constants';

const EVENT_FIELDS = ['name', 'description'] as const;

const EVENT_FILTERS = [
  {
    key: 'q',
    kind: 'search',
    label: 'Search events',
    placeholder: 'Search events by name',
    primary: true,
  },
  {
    key: 'activeOnly',
    kind: 'choice',
    label: 'Filter by status',
    primary: true,
    items: [
      { value: '', label: 'Any status' },
      { value: 'true', label: 'Active' },
    ],
  },
] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function eventColumns(
  canWrite: boolean,
  refresh: () => void,
  onEdit: (event: Event) => void,
  onAddCandidates: (event: Event) => void,
): DataTableColumn<Event>[] {
  return [
    {
      key: 'name',
      header: 'Event',
      className: 'max-w-[18rem] font-medium',
      cell: (event) => <TruncatedText>{event.name}</TruncatedText>,
    },
    {
      key: 'description',
      header: 'Description',
      className: 'max-w-[22rem]',
      cell: (event) => <TruncatedText>{event.description}</TruncatedText>,
    },
    {
      key: 'candidates',
      header: 'Candidates',
      numeric: true,
      // A count is a link: the roster is the students screen filtered, not a second table here.
      cell: (event) =>
        event.candidateCount === 0 ? (
          event.candidateCount
        ) : (
          <Link
            to={`${ROUTES.STUDENTS}?eventId=${event.id}`}
            className={linkVariants({ variant: 'inline' })}
          >
            {event.candidateCount}
          </Link>
        ),
    },
    {
      key: 'series',
      header: 'Series',
      numeric: true,
      cell: (event) => event.seriesCount,
    },
    { key: 'status', header: 'Status', cell: (event) => <EventStatus event={event} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (event) => (
        <EventRowActions
          event={event}
          canWrite={canWrite}
          onChanged={refresh}
          onEdit={onEdit}
          onAddCandidates={() => onAddCandidates(event)}
        />
      ),
    },
  ];
}

/** The roster an Event Test draws on. Who is on one is the students screen, filtered to it. */
export function EventsList({
  creating,
  onCreatingChange,
}: Readonly<{ creating: boolean; onCreatingChange: (open: boolean) => void }>) {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [editing, setEditing] = useState<Event | null>(null);
  const [adding, setAdding] = useState<Event | null>(null);
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EVENTS });
  }, [queryClient]);

  const startEdit = useCallback(
    (event: Event) => {
      onCreatingChange(false);
      setEditing(event);
    },
    [onCreatingChange],
  );

  const columns = useMemo(
    () => eventColumns(canWrite, refresh, startEdit, setAdding),
    [canWrite, refresh, startEdit],
  );

  const events = useListScreen({
    queryKey: QUERY_KEYS.EVENTS,
    filters: EVENT_FILTERS,
    toQuery: (values) => ({
      q: values.q || undefined,
      activeOnly: (values.activeOnly || undefined) as 'true' | undefined,
    }),
    fetchPage: (params) => api.admin.events.list(params),
  });

  return (
    <>
      {/* Portalled, so where these sit in the tree costs the pinned header nothing. */}
      <NewEventDialog
        open={creating}
        onOpenChange={onCreatingChange}
        onDone={() => {
          onCreatingChange(false);
          refresh();
        }}
      />

      {/* Keyed and mounted only while editing, so its defaults are the row that was clicked. */}
      {editing ? (
        <EditEventDialog
          key={editing.id}
          event={editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {adding ? (
        <AddCandidatesDialog
          key={adding.id}
          event={adding}
          onDone={() => {
            setAdding(null);
            refresh();
          }}
          onClose={() => setAdding(null)}
        />
      ) : null}

      <ListView
        list={events}
        filters={EVENT_FILTERS}
        columns={columns}
        rowKey={(event) => event.id}
        empty={{
          title: 'No events yet',
          hint: 'Add the first one — an Event Test reaches only the candidates on one.',
        }}
        emptyFiltered="No events match those filters"
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function NewEventDialog({
  open,
  onOpenChange,
  onDone,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }>) {
  const form = useForm<CreateEventInput>({
    resolver: zodResolver(createEventSchema),
    defaultValues: { name: '', description: '' },
  });

  const create = useMutation({
    meta: { success: 'Event created.', fields: EVENT_FIELDS },
    mutationFn: (values: CreateEventInput) => api.admin.events.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, EVENT_FIELDS),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New event"
      submitLabel="Create"
      loading={create.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} placeholder="Scholarship Test 2026" autoFocus />}
      </FormField>

      <FormField form={form} name="description" label="Description">
        {(control) => <Textarea {...control} rows={3} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

function EditEventDialog({
  event,
  onDone,
  onClose,
}: Readonly<{ event: Event; onDone: () => void; onClose: () => void }>) {
  const form = useForm<UpdateEventInput>({
    resolver: zodResolver(updateEventSchema),
    defaultValues: { name: event.name, description: event.description ?? '' },
  });

  const save = useMutation({
    meta: { success: 'Event saved.', fields: EVENT_FIELDS },
    mutationFn: (values: UpdateEventInput) => api.admin.events.update(event.id, values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, EVENT_FIELDS),
  });

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      form={form}
      onSubmit={(values) => save.mutate(values)}
      title={`Edit ${event.name}`}
      submitLabel="Save"
      loading={save.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} autoFocus />}
      </FormField>

      <FormField form={form} name="description" label="Description">
        {(control) => <Textarea {...control} rows={3} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

/** One question at a time: two booleans could render two dialogs at once. */
const EVENT_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type EventConfirm = (typeof EVENT_CONFIRMS)[keyof typeof EVENT_CONFIRMS];

function EventStatus({ event }: Readonly<{ event: Event }>) {
  if (event.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/** A component, not a ternary: the first state is "render nothing", and the dialogs live below. */
function EventActions({
  event,
  canWrite,
  busy,
  onAsk,
  onEdit,
  onAddCandidates,
}: Readonly<{
  event: Event;
  canWrite: boolean;
  busy: boolean;
  onAsk: (confirm: EventConfirm) => void;
  onEdit: () => void;
  onAddCandidates: () => void;
}>) {
  if (!canWrite) return null;

  return (
    <RowActions label={`Actions for ${event.name}`}>
      <DropdownMenuItem disabled={busy} onSelect={onEdit}>
        <Pencil aria-hidden />
        Edit
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={onAddCandidates}>
        <Plus aria-hidden />
        Add candidates
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={ROUTES.EVENT_IMPORT(event.id)}>
          <Upload aria-hidden />
          Import candidates
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={() => onAsk(EVENT_CONFIRMS.RETIRE)}>
        <Power aria-hidden />
        {event.isActive ? 'Retire' : 'Reactivate'}
      </DropdownMenuItem>
      {/* Left out, not disabled: the server refuses while a series names it, and the count says so. */}
      {event.seriesCount === 0 ? (
        <DropdownMenuItem destructive disabled={busy} onSelect={() => onAsk(EVENT_CONFIRMS.DELETE)}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      ) : null}
    </RowActions>
  );
}

function retireDescription(event: Event): string {
  if (!event.isActive) {
    return 'The event is offered again when anyone builds a series. Nothing else changes.';
  }
  const kept =
    event.candidateCount === 0
      ? 'Nobody is on it yet, so nothing changes for any student'
      : `Every series already built on it keeps reaching its ${plural(event.candidateCount, 'candidate')}`;
  return `${kept}. What stops is new ones: this event will no longer be offered when anyone builds a series. Reactivating puts it back.`;
}

function deleteDescription(event: Event): string {
  if (event.candidateCount === 0) {
    return 'No series names this event and nobody is on it, so nothing loses access. This cannot be undone.';
  }
  return `No series names this event, so no offering is lost. The ${plural(event.candidateCount, 'candidate')} on it go with it, and this cannot be undone.`;
}

function EventRowActions({
  event,
  canWrite,
  onChanged,
  onEdit,
  onAddCandidates,
}: Readonly<{
  event: Event;
  canWrite: boolean;
  onChanged: () => void;
  onEdit: (event: Event) => void;
  onAddCandidates: () => void;
}>) {
  const [asking, setAsking] = useState<EventConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${event.name} deleted.` },
    mutationFn: () => api.admin.events.remove(event.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or it is left asking a question already answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${event.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.events.update(event.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <EventActions
        event={event}
        canWrite={canWrite}
        busy={busy}
        onAsk={setAsking}
        onEdit={() => onEdit(event)}
        onAddCandidates={onAddCandidates}
      />

      {/* Retiring only drops it from the series picker: access never reads this switch. */}
      <ConfirmDialog
        open={asking === EVENT_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={event.isActive ? `Retire ${event.name}?` : `Reactivate ${event.name}?`}
        description={retireDescription(event)}
        confirmLabel={event.isActive ? 'Retire event' : 'Reactivate event'}
        onConfirm={() => setActive.mutate(!event.isActive)}
      />

      <ConfirmDialog
        open={asking === EVENT_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${event.name}?`}
        description={deleteDescription(event)}
        confirmLabel="Delete event"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Putting somebody on an event is a grant, so the dialog says what it costs before it writes. */
function AddCandidatesDialog({
  event,
  onDone,
  onClose,
}: Readonly<{ event: Event; onDone: () => void; onClose: () => void }>) {
  const [chosen, setChosen] = useState<string[]>([]);
  const fieldId = `add-candidates-${event.id}`;

  const add = useMutation({
    meta: { success: 'Candidates added.' },
    mutationFn: () => api.admin.events.addCandidates(event.id, { studentIds: chosen }),
    onSuccess: onDone,
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add candidates to {event.name}</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <Alert variant="warning">
            <span>
              Whoever you add reaches every series built on {event.name} from now on, whatever their
              enrolments, programs or branch say. Anyone already on the roster is left exactly as
              they are.
            </span>
          </Alert>

          <Field htmlFor={fieldId} label="Students to add">
            {({ id, 'aria-describedby': describedBy }) => (
              <StudentMultiPicker
                id={id}
                aria-describedby={describedBy}
                value={chosen}
                onChange={setChosen}
              />
            )}
          </Field>
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={chosen.length === 0}
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus aria-hidden />
            Add {plural(chosen.length, 'candidate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
