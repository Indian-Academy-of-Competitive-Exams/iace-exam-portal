import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { type StudentDetail, type StudentEvent } from '@iace/contracts';
import {
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  FormSection,
  RowActions,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function studentEventColumns(
  busy: boolean,
  onRemove: (event: StudentEvent) => void,
): DataTableColumn<StudentEvent>[] {
  return [
    {
      key: 'name',
      header: 'Event',
      className: 'max-w-[20rem] font-medium',
      cell: (event) => <TruncatedText>{event.name}</TruncatedText>,
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (event) => (
        <RowActions label={`Actions for ${event.name}`}>
          <DropdownMenuItem destructive disabled={busy} onSelect={() => onRemove(event)}>
            <UserMinus aria-hidden />
            Remove from event
          </DropdownMenuItem>
        </RowActions>
      ),
    },
  ];
}

const PROGRAM_COLUMNS: DataTableColumn<string>[] = [
  {
    key: 'code',
    header: 'Program',
    className: 'max-w-[20rem] font-medium',
    cell: (code) => <TruncatedText>{code}</TruncatedText>,
  },
];

/** Read-only: a program reaches a student through the roster import, never by hand from here. */
function Programs({ codes }: Readonly<{ codes: readonly string[] }>) {
  return (
    <FormSection title="Programs">
      <DataTable
        columns={PROGRAM_COLUMNS}
        rows={codes}
        rowKey={(code) => code}
        isLoading={false}
        scroll={{}}
        empty="This student is on no program"
      />
    </FormSection>
  );
}

/** Where a candidate comes OFF an event: the roster is managed here, on the student it belongs to. */
export function EventsTab({ detail }: Readonly<{ detail: StudentDetail }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<StudentEvent | null>(null);

  const remove = useMutation({
    meta: { success: 'Removed from the event.' },
    mutationFn: (event: StudentEvent) => api.admin.events.removeCandidate(event.id, detail.id),
    onSuccess: () => {
      setAsking(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EVENTS });
    },
    // Drop out of the confirm on failure, or the row is left asking an answered question.
    onError: () => setAsking(null),
  });

  const columns = useMemo(
    () => studentEventColumns(remove.isPending, setAsking),
    [remove.isPending],
  );

  return (
    <>
      <FormSection title="Events">
        <DataTable
          columns={columns}
          rows={detail.events}
          rowKey={(event) => event.id}
          isLoading={false}
          scroll={{}}
          empty="This student is not a candidate on any event"
        />
      </FormSection>

      <Programs codes={detail.programs} />

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        loading={remove.isPending}
        title={asking ? `Remove ${detail.fullName ?? detail.mobile} from ${asking.name}?` : ''}
        description="They lose every series this event reaches them by, straight away. Attempts already made and their results are kept, and adding them back restores it."
        confirmLabel="Remove candidate"
        onConfirm={() => asking && remove.mutate(asking)}
      />
    </>
  );
}
