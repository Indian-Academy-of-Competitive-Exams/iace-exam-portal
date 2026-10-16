import { normaliseMobile, type LoginHelpBody } from '@iace/contracts';
import { fromDateColumn } from '../common/time/institute-day';

export interface ClaimStudent {
  fullName: string | null;
  mobile: string;
  externalRef: string | null;
  currentBranchId: string | null;
  mobileHistory: { mobile: string }[];
  profile: { dob: Date | null; fatherName: string | null } | null;
}

export interface ClaimCheck {
  claimed: string | null;
  matches: boolean | null;
}

const normalised = (name: string) =>
  name.toLowerCase().replaceAll('.', ' ').replace(/\s+/g, ' ').trim();

export function sameName(onFile: string | null | undefined, claimed: string): boolean {
  return Boolean(onFile) && normalised(onFile as string) === normalised(claimed);
}

const check = (claimed: string | null | undefined, onFile: boolean | null): ClaimCheck => ({
  claimed: claimed ?? null,
  matches: claimed == null ? null : onFile,
});

/** Each claimed field beside whether the linked student's record agrees; null when nothing to compare. */
export function claimChecks(
  claim: LoginHelpBody,
  student: ClaimStudent | null,
  branchName: string | null,
): Record<string, ClaimCheck> {
  const mobile = normaliseMobile(claim.registeredMobile);
  const dob = student?.profile?.dob;
  const father = student?.profile?.fatherName;
  return {
    fullName: check(
      claim.fullName,
      student?.fullName ? sameName(student.fullName, claim.fullName) : null,
    ),
    registeredMobile: check(
      claim.registeredMobile,
      student &&
        (student.mobile === mobile || student.mobileHistory.some((h) => h.mobile === mobile)),
    ),
    dob: check(claim.dob, dob ? fromDateColumn(dob) === claim.dob : null),
    fatherName: check(claim.fatherName, father ? sameName(father, claim.fatherName) : null),
    branch: check(
      branchName,
      student?.currentBranchId ? student.currentBranchId === claim.branchId : null,
    ),
    enrolmentId: check(
      claim.enrolmentId,
      student?.externalRef ? student.externalRef === claim.enrolmentId : null,
    ),
  };
}
