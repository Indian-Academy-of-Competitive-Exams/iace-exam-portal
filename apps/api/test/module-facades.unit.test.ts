import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AuthService } from '../src/auth/auth.service';
import { PinService } from '../src/auth/pin/pin.service';
import { BranchesService } from '../src/branches/branches.service';
import { StudentsService } from '../src/students/students.service';
import { AuditContext } from '../src/audit';
import { FakeConfig, FakePrisma, FakeRedis, makeBranch, makeStudent } from './support/fakes';

/**
 * The three seams docs/03 §4 names, exercised through the facade rather than the internals they
 * used to reach for.
 */

// --------------------------------------------------------------------------- imports → auth
// ---------------------------------------------------------------------------

function authService(): { auth: AuthService; pin: PinService } {
  const redis = new FakeRedis();
  const config = new FakeConfig();
  const pin = new PinService(redis.asService(), config.asService());
  const auth = new AuthService(
    new FakePrisma().asService(),
    // Only `hashPin` is exercised here, and it touches none of these.
    null as never,
    pin,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  return { auth, pin };
}

describe('AuthService.hashPin — the importer’s seam into auth', () => {
  it('produces a hash the login path will accept', async () => {
    const { auth, pin } = authService();

    // The guarantee, end to end: a PIN the IMPORTER hashed must verify against the same PIN at LOGIN.
    const hash = await auth.hashPin('9876');

    assert.equal(await pin.verify(hash, '9876'), true);
    assert.equal(await pin.verify(hash, '9875'), false);
  });

  it('peppers the PIN, so the hash is worthless on its own', async () => {
    const { auth } = authService();
    const unpeppered = new PinService(
      new FakeRedis().asService(),
      new FakeConfig({ PIN_PEPPER: 'a-completely-different-pepper-value' }).asService(),
    );

    const hash = await auth.hashPin('9876');

    // Four digits is 10,000 candidates.
    assert.equal(await unpeppered.verify(hash, '9876'), false);
  });
});

// --------------------------------------------------------------------------- groups → branches
// ---------------------------------------------------------------------------

describe('BranchesService.assertUsable — the groups seam into branches', () => {
  const usable = () =>
    new BranchesService(
      new FakePrisma([], [], [makeBranch({ id: 'br_1' })]).asService(),
      new AuditContext(),
    );

  it('accepts an active branch', async () => {
    // doesNotReject rather than a bare call: "it did not throw" is the whole assertion, and writing it
    // down is what stops the test passing later for the wrong reason — a method that silently stopped
    // checking anything.
    await assert.doesNotReject(() => usable().assertUsable('br_1'));
  });

  it('refuses a retired branch, keyed to the field the form shows', async () => {
    const service = new BranchesService(
      new FakePrisma([], [], [makeBranch({ id: 'br_1', isActive: false })]).asService(),
      new AuditContext(),
    );

    // The failure this exists to prevent: a group created under a centre that has stopped taking them.
    const error = await service.assertUsable('br_1').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.branchId?.[0]);
  });

  it('refuses a branch that does not exist', async () => {
    const service = new BranchesService(new FakePrisma([], [], []).asService(), new AuditContext());

    const error = await service.assertUsable('br_missing').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });
});

// --------------------------------------------------------------------------- me → students
// ---------------------------------------------------------------------------

function studentsWith(student = makeStudent()) {
  const prisma = new FakePrisma([student]);
  return {
    service: new StudentsService(
      prisma.asService(),
      null as never,
      null as never,
      null as never,
      null as never,
    ),
    student,
  };
}

describe('StudentsService.saveDocumentKey — the me seam into students', () => {
  it('stores the key and recomputes profileCompleted from the merged profile', async () => {
    // Everything but the photo is already there, so this one upload is the
    // thing that completes the profile.
    const { service, student } = studentsWith(
      makeStudent({
        profile: {
          motherName: 'A',
          fatherName: 'B',
          dob: new Date('2000-01-01'),
          gender: 'MALE',
          photoUrl: null,
          aadhaarVerified: true,
          panVerified: true,
        },
      }),
    );

    await service.saveDocumentKey('stu_1', 'photoUrl', 'students/stu_1/photo-2.jpg');

    assert.equal(student.profile?.photoUrl, 'students/stu_1/photo-2.jpg');
    // The flag is the half that is easy to forget. A stale `false` means the
    // student keeps being nudged to upload something they just uploaded.
    assert.equal(student.profileCompleted, true);
  });

  it('leaves the flag false while anything is still missing', async () => {
    const { service, student } = studentsWith(makeStudent({ profile: null }));

    await service.saveDocumentKey('stu_1', 'photoUrl', 'students/stu_1/photo-1.jpg');

    assert.equal(student.profile?.photoUrl, 'students/stu_1/photo-1.jpg');
    assert.equal(student.profileCompleted, false);
  });

  it('refuses a student that does not exist', async () => {
    const { service } = studentsWith();

    const error = await service
      .saveDocumentKey('stu_gone', 'photoUrl', 'k')
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('StudentsService.assertExists', () => {
  it('passes for a real student and throws NOT_FOUND otherwise', async () => {
    const { service } = studentsWith();

    await service.assertExists('stu_1');

    // Called BEFORE the upload in MeService, so that a file is never pushed to
    // S3 under a prefix no record will ever point at.
    const error = await service.assertExists('stu_gone').catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

// --------------------------------------------------------------------------- configs → students
// ---------------------------------------------------------------------------

describe('the counts the configs module asks for', () => {
  /**
   * The failure this prevents: the code lives in `Student.enrolledExams` as free text, so
   * `configs` has nothing to join on and would otherwise read the students table itself.
   */
  it('StudentsService.countEnrolledIn counts students enrolled under the code', async () => {
    const prisma = new FakePrisma([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
      makeStudent({ id: 'stu_2', enrolledExams: ['SSC CGL', 'RRB JE'] }),
      makeStudent({ id: 'stu_3', enrolledExams: [] }),
    ]);
    const students = new StudentsService(
      prisma.asService(),
      null as never,
      null as never,
      null as never,
      null as never,
    );

    assert.equal(await students.countEnrolledIn('SSC CGL'), 2);
    assert.equal(await students.countEnrolledIn('RRB JE'), 1);
    assert.equal(await students.countEnrolledIn('SSC CHSL'), 0);
  });
});
