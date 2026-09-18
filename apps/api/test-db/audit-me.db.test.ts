import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { DOCUMENT_KINDS } from '@iace/contracts';
import { type AccessResolverService } from '../src/access';
import { AuditContext } from '../src/audit';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { type BranchesService } from '../src/branches/branches.service';
import { type ExamsService } from '../src/configs';
import { MeService } from '../src/me/me.service';
import { type StorageService } from '../src/storage/storage.service';
import { StudentsService } from '../src/students/students.service';
import { FakeCodeCatalog, FakeEventBus, FakeQueue, fakeStartingPins } from '../test/support/fakes';
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
    fakeStartingPins(),
    new FakeCodeCatalog().asService(),
    auditContext,
    new FakeEventBus().asService(),
    new NotificationOutbox(new FakeQueue().asQueue()),
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

  it('reports the profile diff, not the (empty) student-level diff StudentsService.update files', async () => {
    const { me, recorded } = await build({ motherName: 'Lakshmi' });

    const store = await recorded(() => me.update(STUDENT, { profile: { motherName: 'Laxmi' } }));

    assert.deepEqual(store?.changed, { motherName: { from: 'Lakshmi', to: 'Laxmi' } });
  });

  /** Replacing the student-column diff instead of merging it once filed a self-rename as a row showing no change. */
  it('keeps the student-column half of the diff when a student renames themselves', async () => {
    const { me, recorded } = await build({ fullName: 'Asha', motherName: 'Lakshmi' });

    const store = await recorded(() =>
      me.update(STUDENT, { fullName: 'Asha Rani', profile: { motherName: 'Laxmi' } }),
    );

    assert.deepEqual(store?.changed, {
      fullName: { from: 'Asha', to: 'Asha Rani' },
      motherName: { from: 'Lakshmi', to: 'Laxmi' },
    });
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

describe('MeService.saveDocument — the entity the row is filed against', () => {
  /** `documents/:kind` carries a kind, not an id, so nothing in the request names the student. */
  it('sets the entity id to the student', async () => {
    const { me, recorded } = await build();

    const store = await recorded(() =>
      me.saveDocument(STUDENT, DOCUMENT_KINDS.PHOTO, {
        buffer: Buffer.from('fake-image-bytes'),
        size: 17,
        mimetype: 'image/jpeg',
      }),
    );

    assert.equal(store?.entityId, STUDENT);
  });
});
