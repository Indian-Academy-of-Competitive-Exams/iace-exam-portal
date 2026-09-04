import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Power, Trash2, UserMinus } from 'lucide-react';
import {
  createEventSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  updateEventSchema,
  type CreateEventInput,
  type Event,
  type EventCandidate,
  type UpdateEventInput,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs, useListScreen, useLocalFilters } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenuItem,
  Field,
  FormDialog,
  FormField,
  Input,
  ListView,
  PageHeader,
  plural,
  RowActions,
  TableFrame,
  Textarea,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { StudentMultiPicker } from '../components/access-picker';
import { WHEN_FORMATTER } from '../lib/audit-vocabulary';
import { NAV_ITEMS, QUERY_KEYS } from '../lib/constants';

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
      cell: (event) => event.candidateCount,
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
        <EventRowActions event={event} canWrite={canWrite} onChanged={refresh} onEdit={onEdit} />
      ),
    },
  ];
}

/** The roster an Event Test draws on. Its candidates open under the row, never on a screen of their own. */
export function EventsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.EVENT, PERMISSION_LEVELS.WRITE);
  // The picker reads the student directory, which is a key of its own — see `EventCandidates`.
  const canReadStudents = can(FEATURE_KEYS.STUDENT_MANAGEMENT);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EVENTS });
  }, [queryClient]);

  const startEdit = useCallback((event: Event) => {
    setCreating(false);
    setEditing(event);
  }, []);

  const columns = useMemo(
    () => eventColumns(canWrite, refresh, startEdit),
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

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Events"
      action={
        canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            New event
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <TableFrame header={header}>
      {/* Portalled, so where these sit in the tree costs the pinned header nothing. */}
      <NewEventDialog
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
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

      <ListView
        list={events}
        filters={EVENT_FILTERS}
        columns={columns}
        rowKey={(event) => event.id}
        empty="No events yet. Add the first one — an Event Test reaches only the candidates on one."
        emptyFiltered="No events match those filters."
        expand={{
          render: (event) => (
            <EventCandidates
              event={event}
              canWrite={canWrite}
              canReadStudents={canReadStudents}
              onChanged={refresh}
            />
          ),
          label: (event) => `Show the candidates on ${event.name}`,
        }}
      />
    </TableFrame>
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
}: Readonly<{
  event: Event;
  canWrite: boolean;
  busy: boolean;
  onAsk: (confirm: EventConfirm) => void;
  onEdit: () => void;
}>) {
  if (!canWrite) return null;

  return (
    <RowActions label={`Actions for ${event.name}`}>
      <DropdownMenuItem disabled={busy} onSelect={onEdit}>
        <Pencil aria-hidden />
        Edit
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
}: Readonly<{
  event: Event;
  canWrite: boolean;
  onChanged: () => void;
  onEdit: (event: Event) => void;
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

const candidatesKey = (eventId: string) => [...QUERY_KEYS.EVENTS, eventId, 'candidates'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function candidateColumns(
  event: Event,
  canWrite: boolean,
  refresh: () => void,
): DataTableColumn<EventCandidate>[] {
  return [
    {
      key: 'name',
      header: 'Candidate',
      className: 'max-w-[16rem] font-medium',
      cell: (candidate) => <TruncatedText>{candidate.fullName ?? candidate.mobile}</TruncatedText>,
    },
    {
      key: 'mobile',
      header: 'Mobile number',
      className: 'max-w-36',
      cell: (candidate) => <TruncatedText>{candidate.mobile}</TruncatedText>,
    },
    {
      key: 'addedAt',
      header: 'Added',
      className: 'max-w-48',
      cell: (candidate) => (
        <TruncatedText>{WHEN_FORMATTER.format(new Date(candidate.addedAt))}</TruncatedText>
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (candidate) => (
        <CandidateRowActions
          event={event}
          candidate={candidate}
          canWrite={canWrite}
          onChanged={refresh}
        />
      ),
    },
  ];
}

const CANDIDATE_FILTERS = [
  {
    key: 'q',
    kind: 'search',
    label: 'Search candidates',
    placeholder: 'Search by name or mobile number',
    primary: true,
  },
] as const;

/** A panel, not a screen: nobody looks for a candidate without knowing whose event they are on. */
function EventCandidates({
  event,
  canWrite,
  canReadStudents,
  onChanged,
}: Readonly<{
  event: Event;
  canWrite: boolean;
  canReadStudents: boolean;
  onChanged: () => void;
}>) {
  const eventId = event.id;
  // Local, not the URL: two open panels and the page's own list would otherwise share one `q`.
  const store = useLocalFilters();

  const candidates = useListScreen({
    queryKey: candidatesKey(eventId),
    filters: CANDIDATE_FILTERS,
    store,
    toQuery: (values) => ({ q: values.q || undefined }),
    fetchPage: (params) => api.admin.events.candidates(eventId, params),
  });

  const columns = useMemo(
    () => candidateColumns(event, canWrite, onChanged),
    [event, canWrite, onChanged],
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {canWrite && !canReadStudents ? (
        <Alert variant="info">
          <span>
            Choosing who to add reads the student directory, so it also needs the Students
            permission. A super admin grants it.
          </span>
        </Alert>
      ) : null}

      {canWrite && canReadStudents ? <AddCandidates event={event} onAdded={onChanged} /> : null}

      <ListView
        list={candidates}
        filters={CANDIDATE_FILTERS}
        columns={columns}
        rowKey={(candidate) => candidate.studentId}
        empty="No candidates yet. A series on this event reaches nobody until one is added."
        emptyFiltered="No candidate on this event matches that."
      />
    </div>
  );
}

function AddCandidates({ event, onAdded }: Readonly<{ event: Event; onAdded: () => void }>) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const fieldId = `add-candidates-${event.id}`;

  const add = useMutation({
    meta: { success: 'Candidates added.' },
    mutationFn: () => api.admin.events.addCandidates(event.id, { studentIds: chosen }),
    onSuccess: () => {
      setAsking(false);
      setChosen([]);
      onAdded();
    },
    onError: () => setAsking(false),
  });

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor={fieldId} label="Students to add" className="min-w-56 flex-1">
          {({ id, 'aria-describedby': describedBy }) => (
            <StudentMultiPicker
              id={id}
              aria-describedby={describedBy}
              value={chosen}
              onChange={setChosen}
            />
          )}
        </Field>

        <Button
          type="button"
          variant="outline"
          disabled={chosen.length === 0}
          loading={add.isPending}
          onClick={() => setAsking(true)}
        >
          <Plus aria-hidden />
          Add
        </Button>
      </div>

      {/* Putting somebody on an event is a grant, so it is stated before it is written. */}
      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        loading={add.isPending}
        title={`Add ${plural(chosen.length, 'candidate')} to ${event.name}?`}
        description={`They reach every series built on ${event.name} from now on, whatever their enrolments, programs or branch say. Anyone already on the roster is left exactly as they are.`}
        confirmLabel="Add candidates"
        onConfirm={() => add.mutate()}
      />
    </>
  );
}

function CandidateActions({
  name,
  canWrite,
  busy,
  onAsk,
}: Readonly<{ name: string; canWrite: boolean; busy: boolean; onAsk: () => void }>) {
  if (!canWrite) return null;

  return (
    <RowActions label={`Actions for ${name}`}>
      <DropdownMenuItem destructive disabled={busy} onSelect={onAsk}>
        <UserMinus aria-hidden />
        Remove
      </DropdownMenuItem>
    </RowActions>
  );
}

function CandidateRowActions({
  event,
  candidate,
  canWrite,
  onChanged,
}: Readonly<{
  event: Event;
  candidate: EventCandidate;
  canWrite: boolean;
  onChanged: () => void;
}>) {
  const [asking, setAsking] = useState(false);
  const name = candidate.fullName ?? candidate.mobile;

  const remove = useMutation({
    meta: { success: `${name} removed.` },
    mutationFn: () => api.admin.events.removeCandidate(event.id, candidate.studentId),
    onSuccess: () => {
      setAsking(false);
      onChanged();
    },
    onError: () => setAsking(false),
  });

  return (
    <>
      <CandidateActions
        name={name}
        canWrite={canWrite}
        busy={remove.isPending}
        onAsk={() => setAsking(true)}
      />

      <ConfirmDialog
        open={asking}
        onOpenChange={(open) => !open && setAsking(false)}
        destructive
        loading={remove.isPending}
        title={`Remove ${name} from ${event.name}?`}
        description="They lose every series this event reaches them by, straight away. Attempts already made and their results are kept, and adding them back restores it."
        confirmLabel="Remove candidate"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
