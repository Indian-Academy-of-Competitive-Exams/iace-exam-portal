import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOCUMENT_KINDS, fieldDiff } from '@iace/contracts';
import { AUDITED_PROFILE_FIELDS, MeService } from '../src/me/me.service';
import { AuditContext } from '../src/audit';
import { StudentsService } from '../src/students/students.service';
import { type ExamsService } from '../src/configs';
import { type BranchesService } from '../src/branches/branches.service';
import { type StorageService } from '../src/storage/storage.service';
import {
  FakeCodeCatalog,
  FakeEventBus,
  FakePrisma,
  makeProfile,
  makeStudent,
} from './support/fakes';

describe('the student profile audit diff', () => {
  it('covers the profile fields a student can set about themselves', () => {
    for (const field of ['motherName', 'fatherName', 'dob', 'email', 'address', 'gender']) {
      assert.ok((AUDITED_PROFILE_FIELDS as readonly string[]).includes(field));
    }
  });

  /**
   * The three pre-test fields are what a student is asked for before an exam, so a change to
   * one after the fact is exactly the edit somebody will want to see.
   */
  it('reports a change to a pre-test field', () => {
    const before = {
      motherName: 'Lakshmi',
      fatherName: null,
      dob: null,
      email: null,
      address: null,
      gender: null,
    };

    assert.deepEqual(
      fieldDiff(before, { ...before, motherName: 'Laxmi' }, AUDITED_PROFILE_FIELDS as never),
      { motherName: { from: 'Lakshmi', to: 'Laxmi' } },
    );
  });
});

// ============================================================================
// Driving MeService inside a live AuditContext, the way the interceptor actually
// reads it — a pure-function diff test alone cannot catch setEntityId being left
// out of a route that carries no `:id`, the same class of bug Task 12 fixed for
// permission grants.
// ============================================================================

/** Enough of `StorageService` for a document upload: no S3, no signed URL worth faking beyond a
 * string a test can key off. */
class FakeStorage {
  readonly uploaded: { key: string; contentType: string }[] = [];

  upload(key: string, _body: Buffer, contentType: string) {
    this.uploaded.push({ key, contentType });
    return Promise.resolve({ key, url: `https://storage.local/${key}` });
  }

  createDownloadUrl(key: string) {
    return Promise.resolve(`https://signed.local/${key}`);
  }

  asService(): StorageService {
    return this as unknown as StorageService;
  }
}

function build(students = [makeStudent({ id: 'stu_1' })]) {
  const prisma = new FakePrisma(students);
  const auditContext = new AuditContext();
  const storage = new FakeStorage();
  // Neither exercised: `updateMeSchema` never carries `enrolledExams` or `currentBranchId`,
  // so `StudentsService.update` never reaches either check for these tests.
  const exams = {} as ExamsService;
  const branches = {} as BranchesService;

  const students_ = new StudentsService(
    prisma.asService(),
    storage.asService(),
    exams,
    branches,
    new FakeCodeCatalog().asService(),
    auditContext,
    new FakeEventBus().asService(),
  );
  const me = new MeService(students_, storage.asService(), auditContext);
  return { prisma, auditContext, storage, me };
}

describe('MeService.update — the entity and diff a student’s own edit contributes', () => {
  it('names the entity as the student’s own id — this route carries no :id', async () => {
    const ctx = build();

    await ctx.auditContext.run(async () => {
      await ctx.me.update('stu_1', { profile: { motherName: 'Lakshmi' } });
      assert.equal(ctx.auditContext.current()?.entityId, 'stu_1');
    });
  });

  it('reports the profile diff, not the (empty) student-level diff StudentsService.update files', async () => {
    const ctx = build([
      makeStudent({ id: 'stu_1', profile: makeProfile({ motherName: 'Lakshmi' }) }),
    ]);

    await ctx.auditContext.run(async () => {
      await ctx.me.update('stu_1', { profile: { motherName: 'Laxmi' } });
      assert.deepEqual(ctx.auditContext.current()?.changed, {
        motherName: { from: 'Lakshmi', to: 'Laxmi' },
      });
    });
  });

  /**
   * The failure this prevents: this route can rename the student as well as edit their profile.
   * Replacing StudentsService.update's diff instead of merging it filed a self-rename as an
   * UPDATE row whose `changed` held nothing — a row asserting a change while showing none.
   */
  it('keeps the student-column half of the diff when a student renames themselves', async () => {
    const ctx = build([
      makeStudent({
        id: 'stu_1',
        fullName: 'Asha',
        profile: makeProfile({ motherName: 'Lakshmi' }),
      }),
    ]);

    await ctx.auditContext.run(async () => {
      await ctx.me.update('stu_1', {
        fullName: 'Asha Rani',
        profile: { motherName: 'Laxmi' },
      });

      assert.deepEqual(ctx.auditContext.current()?.changed, {
        fullName: { from: 'Asha', to: 'Asha Rani' },
        motherName: { from: 'Lakshmi', to: 'Laxmi' },
      });
    });
  });

  /** A rename with no profile row at all still has to reach the log. */
  it('reports the rename when the student has no profile row yet', async () => {
    const ctx = build([makeStudent({ id: 'stu_1', fullName: 'Asha', profile: null })]);

    await ctx.auditContext.run(async () => {
      await ctx.me.update('stu_1', { fullName: 'Asha Rani' });

      assert.deepEqual(ctx.auditContext.current()?.changed, {
        fullName: { from: 'Asha', to: 'Asha Rani' },
      });
    });
  });

  it('reports nothing for a save that changed nothing', async () => {
    const ctx = build([
      makeStudent({ id: 'stu_1', profile: makeProfile({ motherName: 'Lakshmi' }) }),
    ]);

    await ctx.auditContext.run(async () => {
      await ctx.me.update('stu_1', { profile: { motherName: 'Lakshmi' } });
      assert.equal(ctx.auditContext.current()?.changed, null);
    });
  });
});

describe('MeService.saveDocument — the entity the row is filed against', () => {
  /**
   * The failure this prevents: `documents/:kind` carries a `kind`, not an `id`, so nothing in the
   * request names the student — the service has to, or the row is filed against the wrong entity.
   */
  it('sets the entity id to the student', async () => {
    const ctx = build();

    await ctx.auditContext.run(async () => {
      await ctx.me.saveDocument('stu_1', DOCUMENT_KINDS.PHOTO, {
        buffer: Buffer.from('fake-image-bytes'),
        size: 17,
        mimetype: 'image/jpeg',
      });
      assert.equal(ctx.auditContext.current()?.entityId, 'stu_1');
    });
  });
});
