import { useQuery } from '@tanstack/react-query';
import {
  BRANCH_TYPE,
  PAGE_SIZE_MAX,
  STUDENT_TYPE,
  type Branch,
  type Paginated,
  type StudentType,
} from '@iace/contracts';
import { api } from './api';
import { QUERY_KEYS } from './constants';

const everyBranch = (page: Paginated<Branch>) => page.items;
const activeBranches = (page: Paginated<Branch>) => page.items.filter((branch) => branch.isActive);

/** The list plus how the read went, so a screen can tell an empty branch list from one that never loaded. */
export interface BranchList {
  branches: Branch[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

/** Unpaged and long-cached, and already scoped by the server: a branch outside theirs is not in it. */
export function useBranches({
  activeOnly = false,
  enabled,
}: { activeOnly?: boolean; enabled?: boolean } = {}): BranchList {
  // One read for both: the server's activeOnly is exactly isActive, so a picker filters the same list.
  const query = useQuery({
    queryKey: QUERY_KEYS.BRANCHES,
    queryFn: () => api.admin.branches.list({ pageSize: PAGE_SIZE_MAX }),
    select: activeOnly ? activeBranches : everyBranch,
    staleTime: 5 * 60_000,
    enabled,
  });

  return {
    branches: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    retry: query.refetch,
  };
}

/** Mirrors `studentBranchBlocker` on the server, so the picker never offers a branch the save refuses. */
export function branchesForStudentType(branches: Branch[], studentType: StudentType): Branch[] {
  if (studentType === STUDENT_TYPE.ONLINE) {
    return branches.filter((branch) => branch.type === BRANCH_TYPE.VIRTUAL);
  }
  if (studentType === STUDENT_TYPE.OFFLINE) {
    return branches.filter((branch) => branch.type !== BRANCH_TYPE.VIRTUAL);
  }
  return [];
}

/** What the branch picker shows for a student type, whether it is the student's to choose, and what a Non-IACE switch drops from `heldId`. */
export function useBranchChoice(studentType: StudentType, heldId = '') {
  const everyBranch = useBranches().branches;
  const branches = branchesForStudentType(useBranches({ activeOnly: true }).branches, studentType);

  if (studentType === STUDENT_TYPE.NON_IACE) {
    return {
      branches,
      locked: true,
      shownId: '',
      hint: 'Non-IACE students have no branch.',
      droppedName: everyBranch.find((branch) => branch.id === heldId)?.name,
    };
  }

  const locked = studentType === STUDENT_TYPE.ONLINE;
  return {
    branches,
    locked,
    /** What a locked picker shows; never sent, because the server places an online student itself. */
    shownId: locked ? (branches[0]?.id ?? '') : undefined,
    hint: locked ? onlineBranchHint(branches.length > 0) : undefined,
    droppedName: undefined,
  };
}

function onlineBranchHint(exists: boolean): string {
  return exists
    ? 'Online students sit in the online branch.'
    : 'No online branch yet. A super admin creates it on the Branches screen.';
}
