import { useQuery } from '@tanstack/react-query';
import {
  BRANCH_TYPE,
  PAGE_SIZE_MAX,
  STUDENT_TYPE,
  type Branch,
  type StudentType,
} from '@iace/contracts';
import { api } from './api';
import { QUERY_KEYS } from './constants';

/** The branch list, unpaged and long-cached: a small list that changes a few times a year. */
export function useBranches(options: { activeOnly?: boolean } = {}): Branch[] {
  const { activeOnly } = options;

  const query = useQuery({
    queryKey: [...QUERY_KEYS.BRANCHES, { activeOnly: activeOnly ?? false }],
    queryFn: () =>
      api.admin.branches.list({
        pageSize: PAGE_SIZE_MAX,
        ...(activeOnly ? { activeOnly: 'true' as const } : {}),
      }),
    staleTime: 5 * 60_000,
  });

  return query.data?.items ?? [];
}

/** One branch out of the list the server already scoped, so a branch outside it reads as missing. */
export function useBranch(branchId: string): { branch: Branch | null; isLoading: boolean } {
  const query = useQuery({
    queryKey: [...QUERY_KEYS.BRANCHES, { activeOnly: false }],
    queryFn: () => api.admin.branches.list({ pageSize: PAGE_SIZE_MAX }),
    staleTime: 5 * 60_000,
  });

  return {
    branch: query.data?.items.find((branch) => branch.id === branchId) ?? null,
    isLoading: query.isLoading,
  };
}

/**
 * The branches a student of this type may sit in — mirrors `studentBranchBlocker` on the server so
 * the picker never offers a branch the save would refuse. NON_IACE sits outside the institute, so
 * every branch is a real answer for them.
 */
export function branchesForStudentType(branches: Branch[], studentType: StudentType): Branch[] {
  if (studentType === STUDENT_TYPE.ONLINE) {
    return branches.filter((branch) => branch.type === BRANCH_TYPE.VIRTUAL);
  }
  if (studentType === STUDENT_TYPE.OFFLINE) {
    return branches.filter((branch) => branch.type !== BRANCH_TYPE.VIRTUAL);
  }
  return branches;
}

/** What the branch picker shows for a student type, and whether it is the student's to choose. */
export function useBranchChoice(studentType: StudentType) {
  const branches = branchesForStudentType(useBranches({ activeOnly: true }), studentType);
  const locked = studentType === STUDENT_TYPE.ONLINE;

  return {
    branches,
    locked,
    /** The one branch a locked picker stands on — absent until a super admin creates it. */
    forcedId: locked ? branches[0]?.id : undefined,
    hint: locked ? onlineBranchHint(branches.length > 0) : undefined,
  };
}

function onlineBranchHint(exists: boolean): string {
  return exists
    ? 'Online students sit in the online branch.'
    : 'No online branch yet — a super admin creates it on the Branches screen.';
}
