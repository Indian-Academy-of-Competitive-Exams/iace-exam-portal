import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { PAGE_SIZE_MAX, type GroupRef } from '@iace/contracts';
import { Alert, Checkbox, Input } from '@iace/ui';
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
   * Every group seen so far, accumulated across searches.
   *
   * Pinning cannot work off the CURRENT results alone: a group ticked in this
   * session and then searched away is in neither `known` nor the new results,
   * so it would vanish — which is indistinguishable from having been
   * unticked, while the count still says it is selected.
   */
  const [seen, setSeen] = useState<Map<string, string>>(
    () => new Map(known.map((group) => [group.id, group.name])),
  );

  useEffect(() => {
    const items = groups.data?.items;
    if (!items?.length) return;
    setSeen((previous) => {
      const next = new Map(previous);
      let added = false;
      for (const group of items) {
        if (!next.has(group.id)) {
          next.set(group.id, group.name);
          added = true;
        }
      }
      return added ? next : previous;
    });
  }, [groups.data]);

  const namesById = seen;

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
                hint={group.branch ?? undefined}
                value={group.id}
                {...register}
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
            <Link to={ROUTES.GROUPS} className="underline underline-offset-4">
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
