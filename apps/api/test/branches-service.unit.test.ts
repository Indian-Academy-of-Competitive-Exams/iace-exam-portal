import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  BRANCH_TYPE,
  ErrorCodes,
  branchListQuerySchema,
  type BranchListQuery,
} from '@iace/contracts';
import { BranchesService } from '../src/branches/branches.service';
import { AuditContext } from '../src/audit';
import { FakeSeriesFanOut, FakePrisma, makeBranch } from './support/fakes';

/** The branch list, exercised through the service rather than its rule helpers. */
function serviceWith(branches = [makeBranch()]) {
  const prisma = new FakePrisma([], [], branches);
  return {
    service: new BranchesService(
      prisma.asService(),
      new FakeSeriesFanOut().asService(),
      new AuditContext(),
    ),
    prisma,
  };
}

/** A parsed query, the way the controller's pipe would hand one over. */
const listQuery = (over: Partial<BranchListQuery> = {}): BranchListQuery =>
  branchListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

const ONLINE = makeBranch({ id: 'br_online', name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL });

describe('BranchesService — listing', () => {
  it('reports the student count each branch carries', async () => {
    const { service } = serviceWith([makeBranch({ _count: { students: 4 } })]);

    const page = await service.list(listQuery());

    assert.equal(page.items[0]?.studentCount, 4);
    assert.equal(page.total, 1);
  });

  it('returns dates as strings, never Date objects', async () => {
    const { service } = serviceWith();

    const page = await service.list(listQuery());

    // The contract says string. A Date would serialise to the same thing over
    // HTTP and then fail the client's schema on the way back in.
    assert.equal(typeof page.items[0]?.createdAt, 'string');
  });
});

describe('BranchesService — creating', () => {
  it('creates a branch that does not exist yet', async () => {
    const { service, prisma } = serviceWith([]);

    const created = await service.create({ name: 'KUKATPALLY' });

    assert.equal(created.name, 'KUKATPALLY');
    assert.equal(prisma.branches.length, 1);
  });

  /**
   * Names arrive canonical from the schema, so this catches the REAL duplicate rather than a
   * differently-typed one — and it must be a CONFLICT the form can show against the name field, not
   * a 500 from the unique index.
   */
  it('refuses a duplicate name, against the field', async () => {
    const { service } = serviceWith([makeBranch({ name: 'AMEERPET' })]);

    await assert.rejects(
      () => service.create({ name: 'AMEERPET' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.ok(error.fieldErrors?.name);
        return true;
      },
    );
  });
});

describe('BranchesService — the online branch is protected', () => {
  /**
   * The failure these prevent: the online branch is where every online student sits, and nothing re-creates
   * it. Losing it is not recoverable from the UI.
   */
  it('refuses to delete the online branch, even with nobody under it', async () => {
    const { service } = serviceWith([ONLINE]);

    await assert.rejects(
      () => service.remove('br_online'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.match(error.message, /online branch/);
        return true;
      },
    );
  });

  it('refuses to rename the online branch', async () => {
    const { service } = serviceWith([ONLINE]);

    await assert.rejects(() => service.update('br_online', { name: 'EVERYONE' }), AppException.is);
  });

  it('refuses to deactivate the online branch', async () => {
    const { service } = serviceWith([ONLINE]);

    await assert.rejects(() => service.update('br_online', { isActive: false }), AppException.is);
  });
});

describe('BranchesService — a new branch joins every series', () => {
  /**
   * The other half of the series fan-out. Without it, "every branch has a row for every series"
   * would hold only for the branches that existed on the day each series was created — and a
   * centre opened afterwards would never appear on a scheduling screen at all.
   */
  it('fans the new branch out across the series that already exist', async () => {
    const prisma = new FakePrisma([], [], []);
    const fanOut = new FakeSeriesFanOut();
    const service = new BranchesService(prisma.asService(), fanOut.asService(), new AuditContext());

    const created = await service.create({ name: 'KUKATPALLY' });

    assert.deepEqual(fanOut.branchIds, [created.id]);
  });
});

describe('BranchesService — deleting', () => {
  it('deletes a branch nothing depends on', async () => {
    const { service, prisma } = serviceWith([makeBranch({ id: 'br_1' })]);

    await service.remove('br_1');

    assert.equal(prisma.branches.length, 0);
  });

  /**
   * Deleting a branch with students would orphan every one of them — and the
   * click would look like it worked.
   */
  it('refuses a branch that still has students, and says how many', async () => {
    const { service, prisma } = serviceWith([makeBranch({ id: 'br_1', _count: { students: 3 } })]);

    await assert.rejects(
      () => service.remove('br_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /3 students/);
        return true;
      },
    );
    assert.equal(prisma.branches.length, 1, 'nothing should have been deleted');
  });

  it('answers NOT_FOUND for a branch that is not there', async () => {
    const { service } = serviceWith([]);

    await assert.rejects(
      () => service.remove('nope'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.NOT_FOUND);
        return true;
      },
    );
  });
});

describe('BranchesService — updating', () => {
  it('renames an ordinary branch', async () => {
    const { service } = serviceWith([makeBranch({ id: 'br_1', name: 'AMEERPET' })]);

    const updated = await service.update('br_1', { name: 'AMEERPET WEST' });

    assert.equal(updated.name, 'AMEERPET WEST');
  });

  it('retires and reactivates one', async () => {
    const { service } = serviceWith([makeBranch({ id: 'br_1' })]);

    assert.equal((await service.update('br_1', { isActive: false })).isActive, false);
    assert.equal((await service.update('br_1', { isActive: true })).isActive, true);
  });

  it('refuses a rename onto a name another branch already has', async () => {
    const { service } = serviceWith([
      makeBranch({ id: 'br_1', name: 'AMEERPET' }),
      makeBranch({ id: 'br_2', name: 'KUKATPALLY' }),
    ]);

    await assert.rejects(
      () => service.update('br_2', { name: 'AMEERPET' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        return true;
      },
    );
  });

  it('allows a no-op rename to the branch’s own name', async () => {
    const { service } = serviceWith([makeBranch({ id: 'br_1', name: 'AMEERPET' })]);

    assert.equal((await service.update('br_1', { name: 'AMEERPET' })).name, 'AMEERPET');
  });
});
