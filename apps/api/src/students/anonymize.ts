/**
 * Erasure is anonymisation, never a delete. The sittings, the marks and every
 * aggregate they were folded into are facts about a PAPER, and a cohort's mean
 * must not move because one person exercised a right — so the row stays and
 * only the person goes out of it.
 */
import { Prisma } from '@prisma/client';

/** Not a real number: `mobileSchema` demands a leading 6-9, so nothing live can collide with it. */
export const TOMBSTONE_MOBILE = '0000000000';

/** Every column on Student that names a person, and the closed account it leaves behind. */
export function anonymizedStudent(at: Date): Prisma.StudentUncheckedUpdateInput {
  return {
    mobile: TOMBSTONE_MOBILE,
    fullName: null,
    externalRef: null,
    // Nothing to sign in with, and no PIN worth keeping the hash of.
    pinHash: null,
    pinIsDefault: true,
    isActive: false,
    deletedAt: at,
    anonymizedAt: at,
  };
}

/** The profile is PII end to end, so it is emptied rather than picked over. */
export function anonymizedProfile(): Prisma.StudentProfileUncheckedUpdateInput {
  return {
    motherName: null,
    fatherName: null,
    dob: null,
    email: null,
    address: null,
    gender: null,
    photoUrl: null,
    tenthMarksheetUrl: null,
    educationDetails: Prisma.DbNull,
    pastExamHistory: Prisma.DbNull,
    // A verification is a claim about a document that no longer has an owner here.
    aadhaarVerified: false,
    panVerified: false,
  };
}
