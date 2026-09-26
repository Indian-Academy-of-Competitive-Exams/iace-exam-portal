import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { BRANCH_TYPE, pinSchema } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { MESSAGE_KINDS, type MessageSender } from '../src/common/messaging';
import { ImportsService } from '../src/imports/imports.service';
import {
  FakeEventsService,
  FakeMessageSender,
  FakeProgramsService,
  FakeStorage,
  fakeStartingPins,
  roster,
} from '../test/support/fakes';
import { type PrismaService } from '../src/prisma/prisma.service';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
  // The roster names the ONLINE branch, so the database has to hold one for the rows to resolve.
  await prisma.branch.create({ data: { name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL } });
});
after(() => prisma.$disconnect());

/** The real minting, over a hash that records the plaintext it was given. */
const importer = (
  sender: MessageSender = new FakeMessageSender(),
  wrap: (client: PrismaService) => PrismaService = (client) => client,
) =>
  new ImportsService(
    wrap(prisma),
    fakeStartingPins(sender, (pin) => Promise.resolve(`hashed:${pin}`)),
    new FakeStorage() as never,
    new AuditService(prisma, new FakeStorage() as never),
    new FakeEventsService().asService(),
    new FakeProgramsService().asService(),
  );

const sheet = (body: string) => Buffer.from(roster(body));

const pinOf = (hash: string | null | undefined): string => String(hash).replace('hashed:', '');

const ADMIN = randomUUID();

const students = () =>
  prisma.student.findMany({ select: { mobile: true, pinHash: true }, orderBy: { mobile: 'asc' } });

describe('the PIN a roster import issues', () => {
  /** The whole point: a leaked roster used to BE the list of PINs, because each was the mobile. */
  it('is not derived from the number it belongs to', async () => {
    await importer().commitStudents(
      sheet('mobile,fullName\n9876543210,Asha\n9876500000,Bala'),
      ADMIN,
    );

    const issued = await students();
    assert.equal(issued.length, 2);
    for (const student of issued) {
      const pin = pinOf(student.pinHash);
      assert.equal(pinSchema.safeParse(pin).success, true, pin);
      assert.ok(!student.mobile.startsWith(pin), `${pin} is the first digits of ${student.mobile}`);
    }
  });

  it('is different for every student in one file', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `98765${String(i).padStart(5, '0')}`);

    await importer().commitStudents(sheet(`mobile\n${rows.join('\n')}`), ADMIN);

    const pins = new Set((await students()).map((student) => pinOf(student.pinHash)));
    assert.ok(pins.size > 1, 'every imported student got the same PIN');
  });

  /** Nobody can derive it any more, so a PIN nobody was told is an account nobody can open. */
  it('is texted to each student it was issued to, and to nobody else', async () => {
    await makeStudent(prisma, { mobile: '9000000001', pinHash: 'hashed:1234' });
    const sender = new FakeMessageSender();

    await importer(sender).commitStudents(
      sheet('mobile,fullName\n9876543210,Asha\n9000000001,Renamed'),
      ADMIN,
    );

    assert.equal(sender.sent.length, 1);
    assert.equal(sender.lastMessage.kind, MESSAGE_KINDS.PIN);
    assert.equal(sender.lastMessage.to, '9876543210');
    const issued = await prisma.student.findFirstOrThrow({ where: { mobile: '9876543210' } });
    assert.equal(sender.lastMessage.data?.pin, pinOf(issued.pinHash));
    assert.ok(sender.lastMessage.body.includes(String(sender.lastMessage.data?.pin)));
  });

  /** A roster that imported has imported: an aggregator refusing one number is not a failed run. */
  it('does not fail the import when a message cannot be delivered', async () => {
    const failing = { send: () => Promise.reject(new Error('provider is down')) };

    const result = await importer(failing).commitStudents(sheet('mobile\n9876543210'), ADMIN);

    assert.equal(result.created, 1);
    assert.equal(await prisma.student.count(), 1);
  });
});

describe('the enrolment a program import writes', () => {
  const PROGRAM = 'SSC FOUNDATION';
  const enrolmentSheet = (...mobiles: string[]) =>
    Buffer.from(['mobile,full_name', ...mobiles.map((m) => `${m},Someone`)].join('\n'));

  /** One statement for the whole sheet, so what it wrote is what the run reports. */
  it('adds the code to every student the sheet names', async () => {
    await makeStudent(prisma, { mobile: '9000000001' });
    await makeStudent(prisma, { mobile: '9000000002' });

    const result = await importer().commitProgramStudents(
      PROGRAM,
      enrolmentSheet('9000000001', '9000000002'),
      ADMIN,
    );

    assert.equal(result.enrolled, 2);
    assert.deepEqual(
      (
        await prisma.student.findMany({ orderBy: { mobile: 'asc' }, select: { programs: true } })
      ).map((row) => row.programs),
      [[PROGRAM], [PROGRAM]],
    );
  });

  /** The failure this prevents: a stale preview left the student holding the code twice. */
  it('leaves a student enrolled since the preview holding the code once', async () => {
    const student = await makeStudent(prisma, { mobile: '9000000001' });

    const result = await importer(new FakeMessageSender(), (client) =>
      enrollingFirst(client, student.id, PROGRAM),
    ).commitProgramStudents(PROGRAM, enrolmentSheet('9000000001'), ADMIN);

    const [held] = await prisma.student.findMany({ select: { programs: true } });
    assert.deepEqual(held?.programs, [PROGRAM], 'once, not twice');
    assert.equal(result.enrolled, 0, 'nothing was written, so nothing is reported as enrolled');
  });
});

/** The real client, enrolling the student itself just before the import's own statement runs. */
function enrollingFirst(client: PrismaService, studentId: string, code: string): PrismaService {
  let armed = true;
  return new Proxy(client, {
    get(target, key) {
      const held = Reflect.get(target, key) as unknown;
      if (key !== '$queryRaw' || !armed) return held;
      return async (...args: unknown[]) => {
        armed = false;
        await client.student.update({ where: { id: studentId }, data: { programs: [code] } });
        return Reflect.apply(held as (...a: unknown[]) => Promise<unknown>, target, args);
      };
    },
  });
}
