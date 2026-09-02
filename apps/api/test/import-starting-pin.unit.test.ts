import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BRANCH_TYPE, pinSchema } from '@iace/contracts';
import { MESSAGE_KINDS } from '../src/common/messaging';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import { type StudentGrantsService } from '../src/access';
import { EVERY_BRANCH } from '../src/common/security';
import {
  FakeMessageSender,
  fakeStartingPins,
  FakePrisma,
  FakeStorage,
  makeBranch,
  makeStudent,
  roster,
  type FakeStudent,
} from './support/fakes';

const fakeGrants = (): StudentGrantsService =>
  ({ grantMany: () => Promise.resolve() }) as unknown as StudentGrantsService;

function build(students: FakeStudent[] = []) {
  const prisma = new FakePrisma(
    students,
    [],
    [makeBranch({ id: 'br_online', name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL })],
  );
  const sender = new FakeMessageSender();
  const service = new ImportsService(
    prisma.asService(),
    // The real minting, over a hash that records the plaintext it was given.
    fakeStartingPins(sender, (pin) => Promise.resolve(`hashed:${pin}`)),
    new FakeStorage() as never,
    new AuditService(prisma.asService(), new FakeStorage() as never),
    fakeGrants(),
  );
  return { prisma, sender, service };
}

const sheet = (body: string) => Buffer.from(roster(body));

const pinOf = (hash: string | null | undefined): string => String(hash).replace('hashed:', '');

describe('the PIN a roster import issues', () => {
  /** The whole point: a leaked roster used to BE the list of PINs, because each was the mobile. */
  it('is not derived from the number it belongs to', async () => {
    const { prisma, service } = build();

    await service.commitStudents(
      sheet('mobile,fullName\n9876543210,Asha\n9876500000,Bala'),
      'adm_1',
      EVERY_BRANCH,
    );

    const pins = prisma.students.map((student) => pinOf(student.pinHash));
    assert.equal(pins.length, 2);
    for (const [index, pin] of pins.entries()) {
      assert.equal(pinSchema.safeParse(pin).success, true, pin);
      assert.ok(
        !prisma.students[index]!.mobile.startsWith(pin),
        `${pin} is the first digits of the number it was issued to`,
      );
    }
  });

  it('is different for every student in one file', async () => {
    const { prisma, service } = build();
    const rows = Array.from({ length: 12 }, (_, i) => `98765${String(i).padStart(5, '0')}`);

    await service.commitStudents(sheet(`mobile\n${rows.join('\n')}`), 'adm_1', EVERY_BRANCH);

    const pins = new Set(prisma.students.map((student) => pinOf(student.pinHash)));
    assert.ok(pins.size > 1, 'every imported student got the same PIN');
  });

  /** Nobody can derive it any more, so a PIN nobody was told is an account nobody can open. */
  it('is texted to each student it was issued to, and to nobody else', async () => {
    const { prisma, sender, service } = build([
      makeStudent({ id: 'stu_1', mobile: '9000000001', pinHash: 'hashed:1234' }),
    ]);

    await service.commitStudents(
      sheet('mobile,fullName\n9876543210,Asha\n9000000001,Renamed'),
      'adm_1',
      EVERY_BRANCH,
    );

    assert.equal(sender.sent.length, 1);
    assert.equal(sender.lastMessage.kind, MESSAGE_KINDS.PIN);
    assert.equal(sender.lastMessage.to, '9876543210');

    const issued = prisma.students.find((student) => student.mobile === '9876543210');
    assert.equal(sender.lastMessage.data?.pin, pinOf(issued?.pinHash));
    assert.ok(sender.lastMessage.body.includes(String(sender.lastMessage.data?.pin)));
  });

  /** A roster that imported has imported: an aggregator refusing one number is not a failed run. */
  it('does not fail the import when a message cannot be delivered', async () => {
    const { prisma } = build();
    const failing = { send: () => Promise.reject(new Error('provider is down')) };
    const withFailingSender = new ImportsService(
      prisma.asService(),
      fakeStartingPins(failing),
      new FakeStorage() as never,
      new AuditService(prisma.asService(), new FakeStorage() as never),
      fakeGrants(),
    );

    const result = await withFailingSender.commitStudents(
      sheet('mobile\n9876543210'),
      'adm_1',
      EVERY_BRANCH,
    );

    assert.equal(result.created, 1);
    assert.equal(prisma.students.length, 1);
  });
});
