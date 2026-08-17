/** The two derived flags on Student, in one place. */

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

/** The `StudentProfile` columns an uploaded file lands in. */
export type ProfileDocumentColumn = 'photoUrl' | 'aadhaarUrl' | 'panUrl';

const present = (value: unknown): boolean =>
  value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');

/**
 * Mother's name + father's name + DOB. This is the LIGHT gate — prompted before a test, never
 * blocking — so it deliberately asks for three fields and not the whole profile.
 */
export function isPreTestReady(profile: PreTestFields | null | undefined): boolean {
  if (!profile) return false;
  return present(profile.motherName) && present(profile.fatherName) && present(profile.dob);
}

/**
 * The FULL profile: photo, DOB, gender, Aadhaar and PAN. Optional throughout — it drives a gentle
 * nudge and nothing else.
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
