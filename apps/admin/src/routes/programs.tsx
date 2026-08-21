import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import {
  createProgramSchema,
  updateProgramSchema,
  type CreateProgramInput,
  type Program,
  type UpdateProgramInput,
} from '@iace/contracts';
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import { NAV_ITEMS } from '../lib/constants';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  FormDialog,
  FormField,
  Input,
  PageHeader,
  Pagination,
  RowActions,
  SearchInput,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { useFilters } from '../lib/use-filters';

const PROGRAM_FIELDS = ['code', 'name'] as const;

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = ['q', 'activeOnly'] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

const PROGRAMS_KEY = ['admin', 'programs'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function programColumns(
  canWrite: boolean,
  refresh: () => void,
  onEdit: (program: Program) => void,
): DataTableColumn<Program>[] {
  return [
    {
      key: 'code',
      header: 'Code',
      cell: (program) => <span className="font-mono text-sm">{program.code}</span>,
    },
    {
      key: 'name',
      header: 'Program',
      className: 'max-w-[18rem] font-medium',
      cell: (program) => <TruncatedText>{program.name}</TruncatedText>,
    },
    { key: 'status', header: 'Status', cell: (program) => <ProgramStatus program={program} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (program) => (
        <ProgramRowActions
          program={program}
          canEdit={canWrite}
          onChanged={refresh}
          onEdit={onEdit}
        />
      ),
    },
  ];
}

/** Anyone managing students may read the catalog, because they pick from it. Only a super admin writes. */
export function ProgramsPage() {
  const { identity: admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const queryClient = useQueryClient();
  const filters = useFilters<FilterKey>();
  const activeOnly = filters.get('activeOnly');

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PROGRAMS_KEY });
  }, [queryClient]);

  const startEdit = useCallback((program: Program) => {
    setCreating(false);
    setEditing(program);
  }, []);

  const columns = useMemo(
    () => programColumns(isSuperAdmin, refresh, startEdit),
    [isSuperAdmin, refresh, startEdit],
  );

  const programs = useListQuery({
    queryKey: PROGRAMS_KEY,
    filters: {
      q: filters.get('q') || undefined,
      activeOnly: (activeOnly || undefined) as 'true' | undefined,
    },
    fetchPage: (params) => api.admin.programs.list(params),
  });

  const header = (
    <>
      <PageHeader
        breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
        title="Programs"
        action={
          isSuperAdmin ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              <Plus aria-hidden />
              New program
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <Alert variant="info" className="mb-5">
          <span>
            Only a super admin can add or change a program. You can see the list to pick from.
          </span>
        </Alert>
      ) : null}
    </>
  );

  const toolbar = (
    <div className="mb-4 flex flex-wrap gap-3">
      <div className="min-w-56 flex-1">
        <SearchInput
          aria-label="Search programs"
          placeholder="Search programs by name"
          value={filters.get('q')}
          onChange={(q) => filters.set({ q })}
        />
      </div>
      <div className="w-44">
        <Combobox
          aria-label="Filter by status"
          clearable={false}
          value={activeOnly}
          onChange={(next) => filters.set({ activeOnly: next })}
          items={[
            { value: '', label: 'Any status' },
            { value: 'true', label: 'Offered now' },
          ]}
        />
      </div>
    </div>
  );

  return (
    <TableFrame header={header} toolbar={toolbar}>
      {/* Portalled, so where these sit in the tree costs the pinned header nothing. */}
      <NewProgramDialog
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
      />

      {/* Keyed and mounted only while editing, so its defaults are the row that was clicked. */}
      {editing ? (
        <EditProgramDialog
          key={editing.id}
          program={editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {/* "None match" and "there are none" are different facts, and telling an
          admin the wrong one sends them looking in the wrong place. */}
      <DataTable
        columns={columns}
        rows={programs.items}
        rowKey={(program) => program.id}
        isLoading={programs.isLoading}
        empty={
          filters.activeCount(ALL_FILTERS) > 0
            ? 'No programs match those filters.'
            : 'No programs yet. Add the first one — a series can then be aimed at it.'
        }
        footer={programs.hasLoaded ? <Pagination {...programs.pagination} /> : null}
      />
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewProgramDialog({
  open,
  onOpenChange,
  onDone,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }>) {
  const form = useForm<CreateProgramInput>({
    resolver: zodResolver(createProgramSchema),
    defaultValues: { code: '', name: '' },
  });

  const create = useMutation({
    meta: { success: 'Program created.', fields: PROGRAM_FIELDS },
    mutationFn: (values: CreateProgramInput) => api.admin.programs.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, PROGRAM_FIELDS),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => create.mutate(values)}
      title="New program"
      submitLabel="Create"
      loading={create.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} placeholder="SSC Foundation 2026" autoFocus />}
      </FormField>

      <FormField form={form} name="code" label="Code">
        {(control) => (
          <Input
            {...control}
            className="uppercase placeholder:normal-case"
            placeholder="SSC FOUNDATION"
          />
        )}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

/**
 * A typo in a code must be fixable before anything carries it; after that the server refuses with
 * a `fieldErrors.code`. Nothing on this row counts the holders, so the input stays editable and
 * the save is what refuses.
 */
function EditProgramDialog({
  program,
  onDone,
  onClose,
}: Readonly<{ program: Program; onDone: () => void; onClose: () => void }>) {
  const form = useForm<UpdateProgramInput>({
    resolver: zodResolver(updateProgramSchema),
    defaultValues: { code: program.code, name: program.name },
  });

  const save = useMutation({
    meta: { success: 'Program saved.', fields: PROGRAM_FIELDS },
    mutationFn: (values: UpdateProgramInput) => api.admin.programs.update(program.id, values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, PROGRAM_FIELDS),
  });

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      form={form}
      onSubmit={(values) => save.mutate(values)}
      title={`Edit ${program.name}`}
      submitLabel="Save"
      loading={save.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} autoFocus />}
      </FormField>

      <FormField
        form={form}
        name="code"
        label="Code"
        hint="Free to change only while no student and no series carries it — the save is refused after that."
      >
        {(control) => <Input {...control} className="uppercase placeholder:normal-case" />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

/** One question at a time: two booleans could render two dialogs at once. */
const PROGRAM_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type ProgramConfirm = (typeof PROGRAM_CONFIRMS)[keyof typeof PROGRAM_CONFIRMS];

function ProgramStatus({ program }: Readonly<{ program: Program }>) {
  if (program.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/**
 * The buttons only ask; both dialogs live with the mutations in `ProgramRowActions`.
 * A component, not a ternary, because the first state is "render nothing".
 */
function ProgramActions({
  program,
  canEdit,
  busy,
  onAsk,
  onEdit,
}: Readonly<{
  program: Program;
  canEdit: boolean;
  busy: boolean;
  onAsk: (confirm: ProgramConfirm) => void;
  onEdit: () => void;
}>) {
  if (!canEdit) return null;

  return (
    <RowActions label={`Actions for ${program.name}`}>
      <DropdownMenuItem disabled={busy} onSelect={onEdit}>
        <Pencil aria-hidden />
        Edit
      </DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={() => onAsk(PROGRAM_CONFIRMS.RETIRE)}>
        <Power aria-hidden />
        {program.isActive ? 'Retire' : 'Reactivate'}
      </DropdownMenuItem>
      <DropdownMenuItem destructive disabled={busy} onSelect={() => onAsk(PROGRAM_CONFIRMS.DELETE)}>
        <Trash2 aria-hidden />
        Delete
      </DropdownMenuItem>
    </RowActions>
  );
}

function ProgramRowActions({
  program,
  canEdit,
  onChanged,
  onEdit,
}: Readonly<{
  program: Program;
  canEdit: boolean;
  onChanged: () => void;
  onEdit: (program: Program) => void;
}>) {
  const [asking, setAsking] = useState<ProgramConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${program.name} deleted.` },
    mutationFn: () => api.admin.programs.remove(program.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${program.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.programs.update(program.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <ProgramActions
        program={program}
        canEdit={canEdit}
        busy={busy}
        onAsk={setAsking}
        onEdit={() => onEdit(program)}
      />

      {/* Retiring is reversible and still asks: nothing about this row changes
          except a badge, and the consequence lands later on somebody else, as a
          program that is not offered when they enrol a student. */}
      <ConfirmDialog
        open={asking === PROGRAM_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={program.isActive ? `Retire ${program.name}?` : `Reactivate ${program.name}?`}
        description={
          program.isActive
            ? `Nothing that already carries ${program.code} changes — every student and every series keeps it and keeps working exactly as now. What stops is new ones: this program will no longer be offered when anyone enrols a student or builds a series. Reactivating puts it back.`
            : 'The program is offered again when anyone enrols a student or builds a series. Nothing else changes.'
        }
        confirmLabel={program.isActive ? 'Retire program' : 'Reactivate program'}
        onConfirm={() => setActive.mutate(!program.isActive)}
      />

      {/* Nothing points back at this row, so the server counts the holders of the
          code and refuses — this says which answer to expect before the click. */}
      <ConfirmDialog
        open={asking === PROGRAM_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${program.name}?`}
        description={`A student and a series carry ${program.code} as plain text, with nothing linking them back to this row. If any of them still does, the delete is refused and the count comes back with it — retire the program instead, which keeps every holder and simply stops it being offered. Deleting cannot be undone.`}
        confirmLabel="Delete program"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
