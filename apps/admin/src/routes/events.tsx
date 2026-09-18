import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Upload } from 'lucide-react';
import {
  createEventSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type CreateEventInput,
  type Event,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { useListScreen } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
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
  Textarea,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { ActiveStatus, RetireDeleteActions } from '../components/retire-delete-actions';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { StudentMultiPicker } from '../components/access-picker';
import { NEW_RECORD, QUERY_KEYS, ROUTES } from '../lib/constants';

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
    {
      key: 'status',
      header: 'Status',
      cell: (event) => <ActiveStatus isActive={event.isActive} />,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (event) => (
        <RetireDeleteActions
          name={event.name}
          noun="event"
          isActive={event.isActive}
          canEdit={canWrite}
          // Left out, not disabled: the server refuses while a series names it, and the count says so.
          canDelete={event.seriesCount === 0}
          resource={api.admin.events}
          id={event.id}
          onChanged={refresh}
          retireText={retireDescription(event)}
          deleteText={deleteDescription(event)}
        >
          {canWrite ? (
            <>
              <DropdownMenuItem onSelect={() => onEdit(event)}>
                <Pencil aria-hidden />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddCandidates(event)}>
                <Plus aria-hidden />
                Add candidates
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={ROUTES.EVENT_IMPORT(event.id)}>
                  <Upload aria-hidden />
                  Import candidates
                </Link>
              </DropdownMenuItem>
            </>
          ) : null}
        </RetireDeleteActions>
      ),
    },
  ];
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

  const close = () => {
    setEditing(null);
    onCreatingChange(false);
  };

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
      {/* Mounted only while open and keyed by its row, so its defaults are the row that was clicked. */}
      {creating || editing ? (
        <EventDialog
          key={editing?.id ?? NEW_RECORD}
          event={editing}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
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
          hint: 'Add the first one. An Event Test reaches only the candidates on one.',
        }}
        emptyFiltered="No events match those filters"
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function EventDialog({
  event,
  onDone,
  onClose,
}: Readonly<{ event: Event | null; onDone: () => void; onClose: () => void }>) {
  const form = useForm<CreateEventInput>({
    resolver: zodResolver(createEventSchema),
    defaultValues: { name: event?.name ?? '', description: event?.description ?? '' },
  });

  const save = useMutation({
    meta: { success: event ? 'Event saved.' : 'Event created.', fields: EVENT_FIELDS },
    mutationFn: (values: CreateEventInput) =>
      event ? api.admin.events.update(event.id, values) : api.admin.events.create(values),
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
      title={event ? `Edit ${event.name}` : 'New event'}
      submitLabel={event ? 'Save' : 'Create'}
      loading={save.isPending}
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
