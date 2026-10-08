import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, IMPORT_LOG_STATUS, STUDENT_TYPE } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { FakeEventsService, FakeProgramsService, FakeStorage, roster } from '../test/support/fakes';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

/** A sheet fills an EVENT: a number we know only joins it, one we do not becomes a NON_IACE account. */

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(events = new FakeEventsService(), client: PrismaService = prisma) {
  const storage = new FakeStorage();
  const service = new ImportsService(
    client,
    storage as never,
    new AuditService(prisma, new FakeStorage() as never),
    events.asService(),
    new FakeProgramsService().asService(),
  );
  return { storage, events, service };
}

/** The real database, with each student create answered by `create` instead — handed the real one to call or not. */
function creatingThrough(
  create: (real: () => Promise<unknown>, mobile: string) => Promise<unknown>,
): PrismaService {
  const students = new Proxy(prisma.student, {
    get(target, key, receiver) {
      if (key !== 'create') return Reflect.get(target, key, receiver) as unknown;
      return (args: Parameters<typeof target.create>[0]) =>
        create(() => target.create(args), args.data.mobile);
    },
  });
  return new Proxy(prisma, {
    get: (target, key, receiver) =>
      key === 'student' ? students : (Reflect.get(target, key, receiver) as unknown),
  });
}

const known = () => makeStudent(prisma, { mobile: '9000000001', fullName: 'Asha' });

const sheet = (body: string) => Buffer.from(roster(body));

const both = 'mobile,fullName\n9000000001,Asha\n9876543210,Ravi';

const stranger = () => prisma.student.findFirstOrThrow({ where: { mobile: '9876543210' } });

const ADMIN_ID = randomUUID();

describe('an event intake — what one commit leaves behind', () => {
  it('creates the stranger as a NON_IACE account and leaves the student we know alone', async () => {
    const existing = await known();
    const { service } = build();

    const result = await service.commitEventCandidates(
      'evt_1',
      sheet('mobile,fullName\n9000000001,Renamed\n9876543210,Ravi'),
      ADMIN_ID,
    );

    assert.deepEqual(
      { created: result.created, added: result.added, skipped: result.skipped },
      { created: 1, added: 2, skipped: 0 },
    );
    const made = await stranger();
    assert.equal(made.studentType, STUDENT_TYPE.NON_IACE);
    assert.equal(made.currentBranchId, null);
    // The whole rule: an intake may not edit anybody, so the sheet's new name is ignored.
    const untouched = await prisma.student.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(untouched.fullName, 'Asha');
  });

  /** The failure this prevents: a student added by a sheet reading a cached catalog without it. */
  it('hands every candidate to the events service, which is what busts their catalog', async () => {
    const existing = await known();
    const { events, service } = build();

    await service.commitEventCandidates('evt_1', sheet(both), ADMIN_ID);

    assert.deepEqual(events.added, [
      { eventId: 'evt_1', studentIds: [existing.id, (await stranger()).id] },
    ]);
  });

  it('imports the rows it can read and reports the one it cannot', async () => {
    const { events, service } = build();

    const result = await service.commitEventCandidates(
      'evt_1',
      sheet('mobile,fullName\n9876543210,Good\nnot-a-number,Bad'),
      ADMIN_ID,
    );

    assert.deepEqual(
      { created: result.created, added: result.added, skipped: result.skipped },
      { created: 1, added: 1, skipped: 1 },
    );
    assert.equal(await prisma.student.count(), 1);
    assert.equal(events.added[0]?.studentIds.length, 1);
  });

  /** The run is what an admin later reads back off the audit screen, sheet and all. */
  it('opens exactly one import run, stores the sheet, and logs a row per candidate', async () => {
    await known();
    const { storage, service } = build();

    await service.commitEventCandidates('evt_1', sheet(both), ADMIN_ID);

    assert.equal(await prisma.importLog.count(), 1);
    assert.equal(storage.objects.size, 1);
    const rows = await prisma.rowActionLog.findMany();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.actorId === ADMIN_ID));
  });
});

describe('an event intake — what a run that meets trouble still leaves', () => {
  const TWO_STRANGERS = 'mobile,fullName\n9876543210,Ravi\n9000000002,Bala';

  /** The failure this prevents: a number registered since the preview failing the run and stranding the rows after it. */
  it('joins a student who took the number mid-run, and carries on', async () => {
    const taken = { id: '' };
    const registeredFirst = async (real: () => Promise<unknown>, mobile: string) => {
      if (mobile === '9876543210') taken.id = (await makeStudent(prisma, { mobile })).id;
      return real();
    };
    const { events, service } = build(new FakeEventsService(), creatingThrough(registeredFirst));

    const result = await service.commitEventCandidates('evt_1', sheet(TWO_STRANGERS), ADMIN_ID);

    assert.deepEqual({ created: result.created, added: result.added }, { created: 1, added: 2 });
    assert.equal(await prisma.student.count(), 2);
    assert.equal(events.added[0]?.studentIds[0], taken.id);
    const [log] = await prisma.importLog.findMany();
    assert.equal(log?.status, IMPORT_LOG_STATUS.COMMITTED);
  });

  /** The failure this prevents: accounts a dead run had already created, left as strangers on no event. */
  it('puts the accounts it created on the event even when the run dies part-way', async () => {
    const dropAfterFirst = (real: () => Promise<unknown>, mobile: string) =>
      mobile === '9876543210' ? real() : Promise.reject(new Error('connection dropped'));
    const { events, service } = build(new FakeEventsService(), creatingThrough(dropAfterFirst));

    await assert.rejects(
      service.commitEventCandidates('evt_1', sheet(TWO_STRANGERS), ADMIN_ID),
      /connection dropped/,
    );

    assert.deepEqual(events.added, [{ eventId: 'evt_1', studentIds: [(await stranger()).id] }]);
    const [log] = await prisma.importLog.findMany();
    assert.equal(log?.status, IMPORT_LOG_STATUS.FAILED);
  });
});

describe('an event intake — what it refuses', () => {
  /** A stale tab pointed at a deleted event must not mint accounts nothing will ever reach. */
  it('writes nothing at all for an event that is not there', async () => {
    const { storage, events, service } = build(new FakeEventsService([]));

    await assert.rejects(
      () => service.commitEventCandidates('evt_gone', sheet(both), ADMIN_ID),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
    assert.equal(await prisma.student.count(), 0);
    assert.equal(await prisma.importLog.count(), 0);
    assert.equal(storage.objects.size, 0);
    assert.deepEqual(events.added, []);
  });

  /** A preview an admin abandons must leave no ImportLog and no S3 object nothing resolves. */
  it('writes nothing on preview, and still says what the file would do', async () => {
    await known();
    const { storage, events, service } = build();

    const plan = await service.previewEventCandidates('evt_1', sheet(both));

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willAdd: 1, invalid: 0 });
    assert.equal(await prisma.student.count(), 1);
    assert.equal(await prisma.importLog.count(), 0);
    assert.equal(storage.objects.size, 0);
    assert.deepEqual(events.added, []);
  });
});
