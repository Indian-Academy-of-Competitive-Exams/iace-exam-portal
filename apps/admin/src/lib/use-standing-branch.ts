import { useEffect } from 'react';
import { type Branch } from '@iace/contracts';
import { browserStorage, useFilters } from '@iace/app-kit/browser';
import { STORAGE_KEYS } from './constants';
import { useBranchList } from './use-branches';

/** Which branch a screen stands in: the URL, then the last one stood in, then their first. */
export function useStandingBranch(): {
  branch: Branch | null;
  branches: Branch[];
  isLoading: boolean;
  /** A branch ASKED for by id that is not one of theirs — a different fact from having none. */
  notYours: boolean;
  choose: (branchId: string) => void;
} {
  const filters = useFilters<'branchId'>();
  const { branches, isLoading } = useBranchList();
  const asked = filters.get('branchId');

  const found = (branchId: string | null) =>
    branchId ? (branches.find((row) => row.id === branchId) ?? null) : null;

  // A remembered branch they no longer reach falls back silently; only an ASKED one is refused.
  const chosen = asked
    ? found(asked)
    : (found(browserStorage.getItem(STORAGE_KEYS.BRANCH)) ?? branches[0] ?? null);

  const standing = chosen?.id;
  // The one writer, so arriving by link pins the branch exactly as choosing it from the list does.
  useEffect(() => {
    if (standing) browserStorage.setItem(STORAGE_KEYS.BRANCH, standing);
  }, [standing]);

  return {
    branch: chosen,
    branches,
    isLoading,
    notYours: asked !== '' && chosen === null && !isLoading,
    choose: (branchId: string) => filters.set({ branchId }),
  };
}
