import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  BRANCH_TYPE,
  ErrorCodes,
  branchListQuerySchema,
  type BranchListQuery,
  type BranchType,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { BranchesService } from '../src/branches/branches.service';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface BranchRow {
  id: string;
  name: string;
  type?: BranchType;
  isActive?: boolean;
  students?: number;
}

const ONLINE: BranchRow = { id: randomUUID(), name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL };
const AMEERPET: BranchRow = { id: randomUUID(), name: 'AMEERPET' };

/** The branches given, each with as many students sitting in it as it names, and the service over them. */
async function serviceWith(branches: BranchRow[] = [AMEERPET]) {
  for (const { students = 0, ...branch } of branches) {
    await prisma.branch.create({ data: { type: BRANCH_TYPE.PHYSICAL, ...branch } });
    for (let n = 0; n < students; n += 1) {
      await makeStudent(prisma, { currentBranchId: branch.id });
    }
  }
  const auditContext = new AuditContext();
  return { auditContext, service: new BranchesService(prisma, auditContext) };
}

/** A parsed query, the way the controller's pipe would hand one over. */
const listQuery = (over: Partial<BranchListQuery> = {}): BranchListQuery =>
  branchListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

const refusedWith = (code: string, field?: string) => (error: unknown) =>
  AppException.is(error) &&
  error.code === code &&
  (field === undefined || Boolean(error.fieldErrors?.[field]));

describe('BranchesService — listing', () => {
  it('reports the student count each branch carries, with dates as strings', async () => {
    const { service } = await serviceWith([{ ...AMEERPET, students: 4 }]);

    const page = await service.list(listQuery());

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.studentCount, 4);
    // The contract says string; a Date would serialise the same and then fail the client's schema.
    assert.equal(typeof page.items[0]?.createdAt, 'string');
  });
});

describe('BranchesService — creating', () => {
  it('creates a physical branch, and the online one when the admin picks that type', async () => {
    const { service } = await serviceWith([]);

    const physical = await service.create({ name: 'KUKATPALLY', type: BRANCH_TYPE.PHYSICAL });
    const online = await service.create({ name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL });

    assert.deepEqual([physical.name, physical.type], ['KUKATPALLY', BRANCH_TYPE.PHYSICAL]);
    assert.equal(online.type, BRANCH_TYPE.VIRTUAL);
    assert.equal(await prisma.branch.count(), 2);
  });

  /** VIRTUAL is a singleton nothing can rename, retire or delete; a second would be a row no screen can clear. */
  it('refuses a second online branch against the type field, and still takes a physical one', async () => {
    const { service } = await serviceWith([ONLINE]);

    await assert.rejects(
      () => service.create({ name: 'ONLINE TWO', type: BRANCH_TYPE.VIRTUAL }),
      refusedWith(ErrorCodes.CONFLICT, 'type'),
    );
    const created = await service.create({ name: 'AMEERPET', type: BRANCH_TYPE.PHYSICAL });
    assert.equal(created.type, BRANCH_TYPE.PHYSICAL);
  });

  /** A duplicate must be a CONFLICT the form shows against the name, not a 500 from the unique index. */
  it('refuses a duplicate name, against the field', async () => {
    const { service } = await serviceWith([AMEERPET]);

    await assert.rejects(
      () => service.create({ name: 'AMEERPET', type: BRANCH_TYPE.PHYSICAL }),
      refusedWith(ErrorCodes.CONFLICT, 'name'),
    );
  });
});

describe('BranchesService — the online branch is protected', () => {
  /** Every online student sits there and nothing re-creates it, so losing it is not recoverable from the UI. */
  it('refuses to delete, rename or deactivate the online branch, even with nobody under it', async () => {
    const { service } = await serviceWith([ONLINE]);

    await assert.rejects(
      () => service.remove(ONLINE.id),
      (error: unknown) =>
        refusedWith(ErrorCodes.CONFLICT)(error) && /online branch/.test((error as Error).message),
    );
    await assert.rejects(() => service.update(ONLINE.id, { name: 'EVERYONE' }), AppException.is);
    await assert.rejects(() => service.update(ONLINE.id, { isActive: false }), AppException.is);
    assert.equal(await prisma.branch.count(), 1);
  });
});

describe('BranchesService — deleting', () => {
  it('deletes a branch nothing depends on', async () => {
    const { service } = await serviceWith([AMEERPET]);

    await service.remove(AMEERPET.id);

    assert.equal(await prisma.branch.count(), 0);
  });

  /** Deleting a branch with students would orphan every one of them, and the click would look like it worked. */
  it('refuses a branch that still has students, and says how many', async () => {
    const { service } = await serviceWith([{ ...AMEERPET, students: 3 }]);

    await assert.rejects(() => service.remove(AMEERPET.id), /3 students/);
    assert.equal(await prisma.branch.count(), 1, 'nothing should have been deleted');
  });

  it('answers NOT_FOUND for a branch that is not there', async () => {
    const { service } = await serviceWith([]);

    await assert.rejects(() => service.remove(randomUUID()), refusedWith(ErrorCodes.NOT_FOUND));
  });
});

describe('BranchesService — updating', () => {
  it('renames an ordinary branch, allows a no-op rename, and retires and reactivates one', async () => {
    const { service } = await serviceWith([AMEERPET]);

    assert.equal(
      (await service.update(AMEERPET.id, { name: 'AMEERPET WEST' })).name,
      'AMEERPET WEST',
    );
    assert.equal(
      (await service.update(AMEERPET.id, { name: 'AMEERPET WEST' })).name,
      'AMEERPET WEST',
    );
    assert.equal((await service.update(AMEERPET.id, { isActive: false })).isActive, false);
    assert.equal((await service.update(AMEERPET.id, { isActive: true })).isActive, true);
  });

  it('refuses a rename onto a name another branch already has', async () => {
    const other = randomUUID();
    const { service } = await serviceWith([AMEERPET, { id: other, name: 'KUKATPALLY' }]);

    await assert.rejects(
      () => service.update(other, { name: 'AMEERPET' }),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  /** The failure this once hid: a fake handing back the row it then mutated, so the diff read null. */
  it('reports a retire in the live audit diff', async () => {
    const { service, auditContext } = await serviceWith([AMEERPET]);

    const changed = await auditContext.run(async () => {
      await service.update(AMEERPET.id, { isActive: false });
      return auditContext.current()?.changed;
    });

    assert.deepEqual(changed, { isActive: { from: true, to: false } });
  });
});

describe('BranchesService.assertUsable — the seam every branch write comes through', () => {
  /** The failure this exists to prevent: a group created under a centre that has stopped taking them. */
  it('accepts an active branch, and refuses a retired or missing one keyed to the field the form shows', async () => {
    const retired = randomUUID();
    const { service } = await serviceWith([
      AMEERPET,
      { id: retired, name: 'RETIRED', isActive: false },
    ]);

    await assert.doesNotReject(() => service.assertUsable(AMEERPET.id));
    await assert.rejects(
      () => service.assertUsable(retired),
      refusedWith(ErrorCodes.VALIDATION_ERROR, 'branchId'),
    );
    await assert.rejects(
      () => service.assertUsable(randomUUID()),
      refusedWith(ErrorCodes.VALIDATION_ERROR),
    );
  });
});
