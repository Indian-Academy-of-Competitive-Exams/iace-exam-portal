import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Power, Trash2 } from 'lucide-react';
import { Badge, ConfirmDialog, DropdownMenuItem, RowActions } from '@iace/ui';

/** One question at a time: two booleans could render two dialogs at once. */
const CONFIRMS = {
  RETIRE: 'retire',
  DELETE: 'delete',
} as const;
type Confirm = (typeof CONFIRMS)[keyof typeof CONFIRMS];

export function ActiveStatus({ isActive }: Readonly<{ isActive: boolean }>) {
  return isActive ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="neutral">Retired</Badge>
  );
}

/** The slice of an `api.admin.*` namespace a retirable catalog row writes through. */
export interface RetirableResource {
  update: (id: string, input: { isActive: boolean }) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

/** A catalog row's menu: the caller's own items, then Retire and Delete, each asking before it writes. */
export function RetireDeleteActions({
  resource,
  id,
  name,
  noun,
  isActive,
  canEdit,
  canDelete = true,
  retireText,
  deleteText,
  deleteTitle = name,
  onChanged,
  children,
}: Readonly<{
  resource: RetirableResource;
  id: string;
  name: string;
  /** Finishes the confirm button: "Retire branch", "Delete branch". */
  noun: string;
  isActive: boolean;
  canEdit: boolean;
  canDelete?: boolean;
  retireText: string;
  deleteText: string;
  deleteTitle?: string;
  onChanged: () => void;
  children?: ReactNode;
}>) {
  const [asking, setAsking] = useState<Confirm | null>(null);
  const close = () => setAsking(null);
  // Closing on failure too, or the row is left asking a question already answered.
  const settle = {
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  };

  const toggle = useMutation({
    meta: { success: (): string => `${name} updated.` },
    mutationFn: (next: boolean) => resource.update(id, { isActive: next }),
    ...settle,
  });
  const drop = useMutation({
    meta: { success: `${name} deleted.` },
    mutationFn: () => resource.remove(id),
    ...settle,
  });

  const verb = isActive ? 'Retire' : 'Reactivate';

  return (
    <>
      <RowActions label={`Actions for ${name}`}>
        {children}
        {canEdit ? (
          <DropdownMenuItem onSelect={() => setAsking(CONFIRMS.RETIRE)}>
            <Power aria-hidden />
            {verb}
          </DropdownMenuItem>
        ) : null}
        {canEdit && canDelete ? (
          <DropdownMenuItem destructive onSelect={() => setAsking(CONFIRMS.DELETE)}>
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        ) : null}
      </RowActions>

      {/* Retiring asks too: nothing on the row changes but a badge, and the effect lands elsewhere. */}
      <ConfirmDialog
        open={asking === CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={toggle.isPending}
        title={`${verb} ${name}?`}
        description={retireText}
        confirmLabel={`${verb} ${noun}`}
        onConfirm={() => toggle.mutate(!isActive)}
      />

      <ConfirmDialog
        open={asking === CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={drop.isPending}
        title={`Delete ${deleteTitle}?`}
        description={deleteText}
        confirmLabel={`Delete ${noun}`}
        onConfirm={() => drop.mutate()}
      />
    </>
  );
}
