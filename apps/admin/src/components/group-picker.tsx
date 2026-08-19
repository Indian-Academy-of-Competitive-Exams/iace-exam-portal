import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, qualifiedGroupName, type GroupRef } from '@iace/contracts';
import { Alert, Checkbox, linkVariants, SearchInput, Separator, Skeleton } from '@iace/ui';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';

/**
 * Picks the groups a student belongs to, searched server-side.
 * Anything already ticked is pinned above the results, or it would vanish on a search.
 */
/** Placeholder rows have no identity of their own, so their keys are fixed. */
const PLACEHOLDER_KEYS = ['a', 'b', 'c', 'd'];

/** What the counter under the list says. */
function selectionSummary(count: number, search: string): string {
  if (count === 0) return 'None selected';
  if (search) return `${count} selected · selected groups stay listed while you search`;
  return `${count} selected`;
}

export function GroupPicker({
  register,
  selectedIds,
  known,
  idPrefix,
  error,
  lockedToSelection = false,
}: Readonly<{
  register: UseFormRegisterReturn;
  selectedIds: string[];
  /** Groups the student already belongs to, so their names render before any search. */
  known: GroupRef[];
  idPrefix: string;
  error?: string;
  /** Unticked boxes lock: a student blocked from tests may lose a grant but not gain one. */
  lockedToSelection?: boolean;
}>) {
  const [search, setSearch] = useState('');

  const groups = useQuery({
    queryKey: ['admin', 'groups', 'picker', search],
    queryFn: () =>
      api.admin.groups.list({ q: search, pageSize: PAGE_SIZE_MAX, acceptsGrants: 'true' }),
    placeholderData: keepPreviousData,
  });

  const results = groups.data?.items ?? [];

  /**
   * Names for the pinnable groups, recorded when a box is ticked.
   * The current results cannot supply them: a ticked group can be searched away.
   */
  const [namesById, setNamesById] = useState<Map<string, string>>(
    () => new Map(known.map((group) => [group.id, labelFor(group)])),
  );

  const remember = (group: { id: string; label: string }) =>
    setNamesById((previous) =>
      previous.has(group.id) ? previous : new Map(previous).set(group.id, group.label),
    );

  // Selected first, then whatever the search turned up, minus the duplicates.
  const pinned = selectedIds.filter((id) => namesById.has(id));
  const rest = results.filter((group) => !pinned.includes(group.id));

  const hasAnyGroups = results.length > 0 || pinned.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        aria-label="Search groups"
        placeholder="Search groups"
        value={search}
        onChange={setSearch}
      />

      <GroupPickerBody hasAnyGroups={hasAnyGroups} isPending={groups.isPending}>
        <div className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
          {pinned.map((id) => (
            <Checkbox
              key={id}
              id={`${idPrefix}-${id}`}
              label={namesById.get(id) ?? id}
              value={id}
              {...register}
            />
          ))}

          {pinned.length > 0 && rest.length > 0 ? <Separator className="my-1" /> : null}

          {rest.map((group) => (
            <Checkbox
              key={group.id}
              id={`${idPrefix}-${group.id}`}
              label={group.name}
              hint={group.examType ?? undefined}
              value={group.id}
              {...register}
              disabled={lockedToSelection}
              onChange={(event) => {
                remember({ id: group.id, label: qualifiedGroupName(group) });
                void register.onChange(event);
              }}
            />
          ))}

          {rest.length === 0 && search !== '' ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No other group matches “{search}”.
            </p>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {selectionSummary(selectedIds.length, search)}
        </p>
      </GroupPickerBody>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The list, the wait, or the empty case — which means no groups exist at all. */
function GroupPickerBody({
  hasAnyGroups,
  isPending,
  children,
}: Readonly<{ hasAnyGroups: boolean; isPending: boolean; children: React.ReactNode }>) {
  if (hasAnyGroups) return <>{children}</>;
  if (isPending) {
    // Holds the box open at roughly the right height while the groups arrive.
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-2">
        {PLACEHOLDER_KEYS.map((key) => (
          <Skeleton key={key} variant="text" />
        ))}
      </div>
    );
  }

  return (
    <Alert variant="warning">
      <span>
        No scholarship or non-IACE group exists yet — those are the only ones granted student by
        student.{' '}
        <Link to={ROUTES.GROUPS} className={linkVariants({ variant: 'inline' })}>
          Create a group
        </Link>
        .
      </span>
    </Alert>
  );
}

/** Exam-qualified: two exams may both run a "SSC CGL MORNING". */
function labelFor(group: GroupRef): string {
  return qualifiedGroupName(group);
}
