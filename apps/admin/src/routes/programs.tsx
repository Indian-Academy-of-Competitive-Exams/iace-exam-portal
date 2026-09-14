import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Pencil, Upload, Users } from 'lucide-react';
import {
  createProgramSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type CreateProgramInput,
  type Program,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { useListScreen } from '@iace/app-kit/browser';
import { NEW_RECORD, QUERY_KEYS, ROUTES } from '../lib/constants';
import {
  Alert,
  DropdownMenuItem,
  FormDialog,
  FormField,
  Input,
  ListView,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { ActiveStatus, RetireDeleteActions } from '../components/retire-delete-actions';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';

const PROGRAM_FIELDS = ['code', 'name'] as const;

const PROGRAM_FILTERS = [
  {
    key: 'q',
    kind: 'search',
    label: 'Search programs',
    placeholder: 'Search programs by name',
    primary: true,
  },
  {
    key: 'activeOnly',
    kind: 'choice',
    label: 'Filter by status',
    primary: true,
    items: [
      { value: '', label: 'Any status' },
      { value: 'true', label: 'Offered now' },
    ],
  },
] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function programColumns(
  canWrite: boolean,
  canImport: boolean,
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
    {
      key: 'status',
      header: 'Status',
      cell: (program) => <ActiveStatus isActive={program.isActive} />,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (program) => (
        <RetireDeleteActions
          name={program.name}
          noun="program"
          isActive={program.isActive}
          canEdit={canWrite}
          resource={api.admin.programs}
          id={program.id}
          onChanged={refresh}
          retireText={
            program.isActive
              ? `Nothing that already carries ${program.code} changes — every student and every series keeps it and keeps working exactly as now. What stops is new ones: this program will no longer be offered when anyone enrols a student or builds a series. Reactivating puts it back.`
              : 'The program is offered again when anyone enrols a student or builds a series. Nothing else changes.'
          }
          deleteText={`A student and a series carry ${program.code} as plain text, with nothing linking them back to this row. If any of them still does, the delete is refused and the count comes back with it — retire the program instead, which keeps every holder and simply stops it being offered. Deleting cannot be undone.`}
        >
          {/* Everyone on this screen holds STUDENT_MANAGEMENT, so who carries a program is always reachable. */}
          <DropdownMenuItem asChild>
            <Link to={`${ROUTES.STUDENTS}?programCode=${encodeURIComponent(program.code)}`}>
              <Users aria-hidden />
              View students
            </Link>
          </DropdownMenuItem>
          {canWrite ? (
            <DropdownMenuItem onSelect={() => onEdit(program)}>
              <Pencil aria-hidden />
              Edit
            </DropdownMenuItem>
          ) : null}
          {/* Enrolling students is the student directory's business, not the catalog's. */}
          {canImport ? (
            <DropdownMenuItem asChild>
              <Link to={ROUTES.PROGRAM_IMPORT(program.code)}>
                <Upload aria-hidden />
                Import students
              </Link>
            </DropdownMenuItem>
          ) : null}
        </RetireDeleteActions>
      ),
    },
  ];
}

/** Anyone managing students may read the catalog, because they pick from it. Only a super admin writes. */
export function ProgramsList({
  creating,
  onCreatingChange,
}: Readonly<{ creating: boolean; onCreatingChange: (open: boolean) => void }>) {
  const { identity: admin, can } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;
  const canImport = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [editing, setEditing] = useState<Program | null>(null);
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROGRAMS });
  }, [queryClient]);

  const close = () => {
    setEditing(null);
    onCreatingChange(false);
  };

  const startEdit = useCallback(
    (program: Program) => {
      onCreatingChange(false);
      setEditing(program);
    },
    [onCreatingChange],
  );

  const columns = useMemo(
    () => programColumns(isSuperAdmin, canImport, refresh, startEdit),
    [isSuperAdmin, canImport, refresh, startEdit],
  );

  const programs = useListScreen({
    queryKey: QUERY_KEYS.PROGRAMS,
    filters: PROGRAM_FILTERS,
    toQuery: (values) => ({
      q: values.q || undefined,
      activeOnly: (values.activeOnly || undefined) as 'true' | undefined,
    }),
    fetchPage: (params) => api.admin.programs.list(params),
  });

  return (
    <>
      {/* Mounted only while open and keyed by its row, so its defaults are the row that was clicked. */}
      {creating || editing ? (
        <ProgramDialog
          key={editing?.id ?? NEW_RECORD}
          program={editing}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
        />
      ) : null}
      <ListView
        list={programs}
        filters={PROGRAM_FILTERS}
        columns={columns}
        rowKey={(program) => program.id}
        banner={
          isSuperAdmin ? undefined : (
            <Alert variant="info">
              <span>Only a super admin can add or change a program.</span>
            </Alert>
          )
        }
        empty={{
          title: 'No programs yet',
          hint: 'Add the first one — a series can then be aimed at it.',
        }}
        emptyFiltered="No programs match those filters"
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * A typo in a code must be fixable before anything carries it; after that the server refuses with
 * a `fieldErrors.code`. Nothing on this row counts the holders, so the input stays editable and
 * the save is what refuses.
 */
function ProgramDialog({
  program,
  onDone,
  onClose,
}: Readonly<{ program: Program | null; onDone: () => void; onClose: () => void }>) {
  const form = useForm<CreateProgramInput>({
    resolver: zodResolver(createProgramSchema),
    defaultValues: { code: program?.code ?? '', name: program?.name ?? '' },
  });

  const save = useMutation({
    meta: { success: program ? 'Program saved.' : 'Program created.', fields: PROGRAM_FIELDS },
    mutationFn: (values: CreateProgramInput) =>
      program ? api.admin.programs.update(program.id, values) : api.admin.programs.create(values),
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
      title={program ? `Edit ${program.name}` : 'New program'}
      submitLabel={program ? 'Save' : 'Create'}
      loading={save.isPending}
    >
      <FormField form={form} name="name" label="Name">
        {(control) => <Input {...control} placeholder="SSC Foundation 2026" autoFocus />}
      </FormField>

      <FormField
        form={form}
        name="code"
        label="Code"
        /* ui-copy-ok: rule */ hint={program ? 'Locked once anything carries it' : undefined}
      >
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
