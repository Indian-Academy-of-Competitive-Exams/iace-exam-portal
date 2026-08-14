/**
 * The two derived flags on Student, in one place.
 *
 * They are stored columns rather than computed on read because ranking and
 * listing filter on them, but that means they are only ever as correct as the
 * last write that recomputed them. Every path that touches a profile — admin
 * edit, student self-service, bulk import — must run this, which is why it is a
 * pure function and not a method on whichever service happened to need it first.
 */

/** The minimal set the pre-test gate asks for. */
export interface PreTestFields {
  motherName?: string | null;
  fatherName?: string | null;
  dob?: Date | string | null;
}

/** Everything `profileCompleted` looks at, per prisma/schema.prisma. */
export interface ProfileCompletionFields extends PreTestFields {
  gender?: string | null;
  photoUrl?: string | null;
  aadhaarUrl?: string | null;
  panUrl?: string | null;
}

/**
 * The `StudentProfile` columns an uploaded file lands in.
 *
 * Named here, beside the flag that reads them, so "which columns hold a
 * document" and "which columns decide `profileCompleted`" cannot drift apart —
 * a new document kind that forgot to join the second list would be a profile
 * that can never be completed.
 */
export type ProfileDocumentColumn = 'photoUrl' | 'aadhaarUrl' | 'panUrl';

const present = (value: unknown): boolean =>
  value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');

/**
 * Mother's name + father's name + DOB. This is the LIGHT gate — prompted before
 * a test, never blocking — so it deliberately asks for three fields and not the
 * whole profile.
 */
export function isPreTestReady(profile: PreTestFields | null | undefined): boolean {
  if (!profile) return false;
  return present(profile.motherName) && present(profile.fatherName) && present(profile.dob);
}

/**
 * The FULL profile: photo, DOB, gender, Aadhaar and PAN. Optional throughout —
 * it drives a gentle nudge and nothing else. Aadhaar and PAN count here even
 * though admins never see them, because the flag describes the student's
 * record, not what any one role is allowed to read.
 */
export function isProfileCompleted(profile: ProfileCompletionFields | null | undefined): boolean {
  if (!profile) return false;
  return (
    present(profile.photoUrl) &&
    present(profile.dob) &&
    present(profile.gender) &&
    present(profile.aadhaarUrl) &&
    present(profile.panUrl)
  );
}
