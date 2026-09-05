import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, STUDENT_TYPE } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import {
  FakeEventsService,
  FakeProgramsService,
  FakeMessageSender,
  fakeStartingPins,
  FakePrisma,
  FakeStorage,
  makeStudent,
  roster,
  type FakeStudent,
} from './support/fakes';

/** A sheet fills an EVENT: a number we know only joins it, one we do not becomes a NON_IACE account. */

function build(students: FakeStudent[] = [], events = new FakeEventsService()) {
  const prisma = new FakePrisma(students);
  const storage = new FakeStorage();
  const service = new ImportsService(
    prisma.asService(),
    fakeStartingPins(new FakeMessageSender()),
    storage as never,
    new AuditService(prisma.asService(), new FakeStorage() as never),
    events.asService(),
    new FakeProgramsService().asService(),
  );
  return { prisma, storage, events, service };
}

const known = () => makeStudent({ id: 'stu_existing', mobile: '9000000001', fullName: 'Asha' });

const sheet = (body: string) => Buffer.from(roster(body));

const both = 'mobile,fullName\n9000000001,Asha\n9876543210,Ravi';

describe('an event intake — what one commit leaves behind', () => {
  it('creates the stranger as a NON_IACE account and leaves the student we know alone', async () => {
    const { prisma, service } = build([known()]);

    const result = await service.commitEventCandidates(
      'evt_1',
      sheet('mobile,fullName\n9000000001,Renamed\n9876543210,Ravi'),
      'adm_1',
    );

    assert.deepEqual(
      { created: result.created, added: result.added, skipped: result.skipped },
      { created: 1, added: 2, skipped: 0 },
    );

    const made = prisma.students.find((student) => student.mobile === '9876543210');
    assert.equal(made?.studentType, STUDENT_TYPE.NON_IACE);
    assert.equal(made?.currentBranchId, null);
    // The whole rule: an intake may not edit anybody, so the sheet's new name is ignored.
    assert.equal(prisma.students.find((s) => s.id === 'stu_existing')?.fullName, 'Asha');
  });

  /** The failure this prevents: a student added by a sheet reading a cached catalog without it. */
  it('hands every candidate to the events service, which is what busts their catalog', async () => {
    const { events, prisma, service } = build([known()]);

    await service.commitEventCandidates('evt_1', sheet(both), 'adm_1');

    const made = prisma.students.find((student) => student.mobile === '9876543210');
    assert.deepEqual(events.added, [
      { eventId: 'evt_1', studentIds: ['stu_existing', String(made?.id)] },
    ]);
  });

  it('imports the rows it can read and reports the one it cannot', async () => {
    const { prisma, events, service } = build();

    const result = await service.commitEventCandidates(
      'evt_1',
      sheet('mobile,fullName\n9876543210,Good\nnot-a-number,Bad'),
      'adm_1',
    );

    assert.deepEqual(
      { created: result.created, added: result.added, skipped: result.skipped },
      { created: 1, added: 1, skipped: 1 },
    );
    assert.equal(prisma.students.length, 1);
    assert.equal(events.added[0]?.studentIds.length, 1);
  });

  /** The run is what an admin later reads back off the audit screen, sheet and all. */
  it('opens exactly one import run, stores the sheet, and logs a row per candidate', async () => {
    const { prisma, storage, service } = build([known()]);

    await service.commitEventCandidates('evt_1', sheet(both), 'adm_1');

    assert.equal(prisma.importLogs.length, 1);
    assert.equal(storage.objects.size, 1);
    assert.equal(prisma.rowActionLogs.length, 2);
    assert.equal(prisma.rowActionLogs[0]?.actorId, 'adm_1');
  });
});

describe('an event intake — what it refuses', () => {
  /** A stale tab pointed at a deleted event must not mint accounts nothing will ever reach. */
  it('writes nothing at all for an event that is not there', async () => {
    const { prisma, storage, events, service } = build([], new FakeEventsService([]));

    const error = await service
      .commitEventCandidates('evt_gone', sheet(both), 'adm_1')
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(prisma.students.length, 0);
    assert.equal(prisma.importLogs.length, 0);
    assert.equal(storage.objects.size, 0);
    assert.deepEqual(events.added, []);
  });

  /** A preview an admin abandons must leave no ImportLog and no S3 object nothing resolves. */
  it('writes nothing on preview, and still says what the file would do', async () => {
    const { prisma, storage, events, service } = build([known()]);

    const plan = await service.previewEventCandidates('evt_1', sheet(both));

    assert.deepEqual(plan.summary, { total: 2, willCreate: 1, willAdd: 1, invalid: 0 });
    assert.equal(prisma.students.length, 1);
    assert.equal(prisma.importLogs.length, 0);
    assert.equal(storage.objects.size, 0);
    assert.deepEqual(events.added, []);
  });
});
