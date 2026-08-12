import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { PAGE_SIZE_MAX, type GroupRef } from '@iace/contracts';
import { Alert, Checkbox, Input, linkVariants } from '@iace/ui';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';

/**
 * Picks the groups a student belongs to.
 *
 * Searching is server-side, because there is no useful cap on how many groups a
 * multi-branch institute has. That creates one hazard worth naming: a group the
 * admin has already ticked can fall outside the current results, and a checkbox
 * that vanishes looks exactly like a selection that was undone. So anything
 * already selected is pinned above the results and stays visible whatever the
 * search says.
 */
export function GroupPicker({
  register,
  selectedIds,
  known,
  idPrefix,
  error,
}: {
  register: UseFormRegisterReturn;
  selectedIds: string[];
  /** Groups the student already belongs to, so their names render before any search. */
  known: GroupRef[];
  idPrefix: string;
  error?: string;
}) {
  const [search, setSearch] = useState('');

  const groups = useQuery({
    queryKey: ['admin', 'groups', 'picker', search],
    queryFn: () => api.admin.groups.list({ q: search, pageSize: PAGE_SIZE_MAX }),
    placeholderData: keepPreviousData,
  });

  const results = groups.data?.items ?? [];

  /**
   * Names for the groups that can be pinned: the ones the student already
   * belongs to, plus any the admin has ticked in this session.
   *
   * Recorded when a box is TICKED rather than accumulated from every search
   * result — that is the only moment a name becomes worth remembering, and it
   * keeps this a plain event-handler update instead of state derived from a
   * query inside an effect.
   *
   * Pinning cannot work off the current results alone: a group ticked and then
   * searched away is in neither `known` nor the new results, so it would
   * vanish — indistinguishable from having been unticked, while the counter
   * still insists one is selected.
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
      <Input
        aria-label="Search groups"
        placeholder="Search groups"
        value={search}
        prefix={<Search className="size-4" aria-hidden />}
        onChange={(event) => setSearch(event.target.value)}
      />

      {hasAnyGroups ? (
        <>
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

            {pinned.length > 0 && rest.length > 0 ? (
              <div className="my-1 border-t border-border" />
            ) : null}

            {rest.map((group) => (
              <Checkbox
                key={group.id}
                id={`${idPrefix}-${group.id}`}
                label={group.name}
                hint={group.branch.name}
                value={group.id}
                {...register}
                onChange={(event) => {
                  remember({ id: group.id, label: `${group.branch.name} / ${group.name}` });
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
            {selectedIds.length === 0
              ? 'None selected'
              : `${selectedIds.length} selected${search ? ' · selected groups stay listed while you search' : ''}`}
          </p>
        </>
      ) : groups.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Alert variant="warning">
          <span>
            No groups yet — a student reaches tests only through one.{' '}
            <Link to={ROUTES.GROUPS} className={linkVariants({ variant: 'inline' })}>
              Create a group
            </Link>
            .
          </span>
        </Alert>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A group is named by its branch as well as itself: two centres may both run a
 * "SSC CGL MORNING", and a pinned checkbox showing only the name would not say
 * which one is ticked.
 */
function labelFor(group: GroupRef): string {
  return `${group.branchName} / ${group.name}`;
}
