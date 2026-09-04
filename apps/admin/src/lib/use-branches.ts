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

/** Unpaged and long-cached, and already scoped by the server: a branch outside theirs is not in it. */
function useBranchList(options: { activeOnly?: boolean } = {}): {
  branches: Branch[];
  isLoading: boolean;
} {
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

  return { branches: query.data?.items ?? [], isLoading: query.isLoading };
}

export function useBranches(options: { activeOnly?: boolean } = {}): Branch[] {
  return useBranchList(options).branches;
}

/** Mirrors `studentBranchBlocker` on the server, so the picker never offers a branch the save refuses. */
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
