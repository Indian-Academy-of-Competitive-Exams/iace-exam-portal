import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, STUDENT_TYPE } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import {
  FakeEventsService,
  FakeMessageSender,
  FakeProgramsService,
  FakeStorage,
  fakeStartingPins,
  roster,
} from '../test/support/fakes';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

/** A sheet fills an EVENT: a number we know only joins it, one we do not becomes a NON_IACE account. */

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(events = new FakeEventsService()) {
  const storage = new FakeStorage();
  const service = new ImportsService(
    prisma,
    fakeStartingPins(new FakeMessageSender()),
    storage as never,
    new AuditService(prisma, new FakeStorage() as never),
    events.asService(),
    new FakeProgramsService().asService(),
  );
  return { storage, events, service };
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
