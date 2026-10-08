import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, DOCUMENT_KINDS, ErrorCodes, updateMeSchema } from '@iace/contracts';
import { type AccessResolverService } from '../src/access';
import { AuditContext } from '../src/audit';
import { NotificationsService } from '../src/notifications/notifications.service';
import { type BranchesService } from '../src/branches/branches.service';
import { type ExamsService } from '../src/configs';
import { MeService } from '../src/me/me.service';
import { type StorageService } from '../src/storage/storage.service';
import { StudentsService } from '../src/students/students.service';
import { FakeCodeCatalog, FakeEventBus } from '../test/support/fakes';
import { jpegBytes } from '../test/support/image-bytes';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

const STUDENT = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Enough of `StorageService` for a document upload: a key in, a URL a test can key off out. */
const storage = {
  upload: (key: string) => Promise.resolve({ key, url: `https://storage.local/${key}` }),
  createDownloadUrl: (key: string) => Promise.resolve(`https://signed.local/${key}`),
} as unknown as StorageService;

/** `stu_1`, named as given, with a profile holding the mother's name given, or none. */
async function build(over: { fullName?: string; motherName?: string | null } = {}) {
  await makeStudent(prisma, { id: STUDENT, fullName: over.fullName ?? null });
  if (over.motherName !== undefined) {
    await prisma.studentProfile.create({
      data: { studentId: STUDENT, motherName: over.motherName },
    });
  }
  const auditContext = new AuditContext();
  const students = new StudentsService(
    prisma,
    storage,
    // Never validated here, but wired all the same: every `me` read resolves the enrolment.
    new FakeCodeCatalog().asService<ExamsService>(),
    { nameOf: () => Promise.resolve(null) } as unknown as BranchesService,
    new FakeCodeCatalog().asService(),
    auditContext,
    new FakeEventBus().asService(),
    new NotificationsService(prisma),
  );
  const me = new MeService(students, storage, {} as AccessResolverService, auditContext);
  /** Runs the edit inside a live AuditContext and hands back what the interceptor would read. */
  const recorded = (edit: () => Promise<unknown>) =>
    auditContext.run(async () => {
      await edit();
      return auditContext.current();
    });
  return { me, recorded };
}

describe('MeService.update — the entity and diff a student’s own edit contributes', () => {
  /** This route carries no `:id`, so the service is what names the entity. */
  it('names the entity as the student’s own id', async () => {
    const { me, recorded } = await build();

    const store = await recorded(() => me.update(STUDENT, { profile: { motherName: 'Lakshmi' } }));

    assert.equal(store?.entityId, STUDENT);
  });

  /** The failure this prevents: a date of birth and an email written into a log that outlives an erasure. */
  it('names the personal fields a student changed, and holds none of their values', async () => {
    const { me, recorded } = await build({ motherName: 'Lakshmi' });
    const profile = {
      motherName: 'Laxmi',
      fatherName: 'Ravi',
      dob: '2004-05-01',
      email: 'asha@example.com',
      address: '12 Tank Bund Road',
    };

    const store = await recorded(() => me.update(STUDENT, { profile }));

    assert.deepEqual(Object.keys(store?.changed ?? {}).sort(), [
      'address',
      'dob',
      'email',
      'fatherName',
      'motherName',
    ]);
    const logged = JSON.stringify(store?.changed);
    for (const value of ['Lakshmi', 'Laxmi', 'Ravi', '2004', 'asha@example.com', 'Tank Bund']) {
      assert.ok(!logged.includes(value), `${value} must not reach the audit log`);
    }
  });

  /** Replacing the student-column diff instead of merging it once filed a self-rename as a row showing no change. */
  it('keeps the student-column half of the diff when a student renames themselves', async () => {
    const { me, recorded } = await build({ fullName: 'Asha', motherName: 'Lakshmi' });

    const store = await recorded(() =>
      me.update(STUDENT, { fullName: 'Asha Rani', profile: { motherName: 'Laxmi' } }),
    );

    assert.deepEqual(Object.keys(store?.changed ?? {}).sort(), ['fullName', 'motherName']);
    assert.deepEqual(store?.changed?.fullName, { from: 'Asha', to: 'Asha Rani' });
  });

  /** A rename with no profile row at all still has to reach the log. */
  it('reports the rename when the student has no profile row yet', async () => {
    const { me, recorded } = await build({ fullName: 'Asha' });

    const store = await recorded(() => me.update(STUDENT, { fullName: 'Asha Rani' }));

    assert.deepEqual(store?.changed, { fullName: { from: 'Asha', to: 'Asha Rani' } });
  });

  it('reports nothing for a save that changed nothing', async () => {
    const { me, recorded } = await build({ motherName: 'Lakshmi' });

    const store = await recorded(() => me.update(STUDENT, { profile: { motherName: 'Lakshmi' } }));

    assert.equal(store?.changed, null);
  });
});

describe('MeService.update — a save from a form opened before another write', () => {
  const stale = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

  /** The failure this prevents: details typed on the phone putting back what was corrected since Edit was tapped. */
  it('is refused on the stamp the form opened with, and saves on the one the record holds', async () => {
    const { me } = await build({ motherName: 'Lakshmi' });
    const opened = await me.profile(STUDENT);
    const corrected = await me.update(STUDENT, { profile: { fatherName: 'Ravi' } });
    // Through the route's own schema: an allowlist that dropped the stamp would save what this refuses.
    const typed = (expectedUpdatedAt: string) =>
      updateMeSchema.parse({ profile: { fatherName: 'Raju' }, expectedUpdatedAt });

    await assert.rejects(() => me.update(STUDENT, typed(opened.updatedAt)), stale);
    assert.equal((await me.profile(STUDENT)).profile?.fatherName, 'Ravi');

    const saved = await me.update(STUDENT, typed(corrected.updatedAt));
    assert.equal(saved.profile?.fatherName, 'Raju');
  });
});

describe('MeService.saveDocument — the entity the row is filed against', () => {
  /** `documents/:kind` carries a kind, not an id, so nothing in the request names the student. */
  it('sets the entity id to the student', async () => {
    const { me, recorded } = await build();

    const bytes = jpegBytes(10, 10);
    const store = await recorded(() =>
      me.saveDocument(STUDENT, DOCUMENT_KINDS.PHOTO, {
        buffer: bytes,
        size: bytes.length,
        mimetype: 'image/jpeg',
      }),
    );

    assert.equal(store?.entityId, STUDENT);
  });
});
