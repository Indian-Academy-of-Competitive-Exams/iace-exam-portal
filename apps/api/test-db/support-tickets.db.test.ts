import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, SUPPORT_CATEGORIES } from '@iace/contracts';
import { NotificationsService } from '../src/notifications';
import { SupportAdminService } from '../src/support/support-admin.service';
import { SupportService } from '../src/support/support.service';
import {
  makeAdmin,
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
} from './support/database';
import { FakeMessageSender, FakeStorage } from '../test/support/fakes';

const prisma = testPrisma();
const support = new SupportService(prisma, new FakeStorage() as never);
const sender = new FakeMessageSender();
const admins = new SupportAdminService(
  prisma,
  new FakeStorage() as never,
  new NotificationsService(prisma),
  sender,
);
const codeOf = (error: unknown) => (AppException.is(error) ? error.code : null);
const ask = (studentId: string, category: keyof typeof SUPPORT_CATEGORIES = 'OTHER') =>
  support.create(studentId, { category, body: 'Where is my paper?' });

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

describe('a student ticket', () => {
  it('opens as the admin’s turn, carrying the first message', async () => {
    const { id: studentId } = await makeStudent(prisma);
    const ticket = await ask(studentId);
    assert.equal(ticket.status, 'OPEN');
    assert.equal(ticket.messages.length, 1);
  });

  it('refuses a fourth open query', async () => {
    const { id: studentId } = await makeStudent(prisma);
    await ask(studentId);
    await ask(studentId);
    await ask(studentId);
    await assert.rejects(ask(studentId), (e) => codeOf(e) === ErrorCodes.TICKET_LIMIT);
  });

  it('frees a slot once a query is closed', async () => {
    const { id: studentId } = await makeStudent(prisma);
    const first = await ask(studentId);
    await ask(studentId);
    await ask(studentId);
    await support.closeAsStudent(studentId, first.id);
    assert.ok(await ask(studentId));
  });

  it('refuses a reply to a closed ticket', async () => {
    const { id: studentId } = await makeStudent(prisma);
    const first = await ask(studentId);
    await support.closeAsStudent(studentId, first.id);
    await assert.rejects(
      support.replyAsStudent(studentId, first.id, { body: 'still there?' }),
      (e) => codeOf(e) === ErrorCodes.TICKET_CLOSED,
    );
  });

  it('reopens an answered ticket on a reply, and hides internal notes', async () => {
    const { id: studentId } = await makeStudent(prisma);
    const ticket = await ask(studentId);
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: 'ANSWERED', answeredAt: new Date() },
    });
    await prisma.supportMessage.create({
      data: { ticketId: ticket.id, authorType: 'ADMIN', body: 'note', internal: true },
    });
    const after = await support.replyAsStudent(studentId, ticket.id, { body: 'thanks' });
    assert.equal(after.status, 'OPEN');
    assert.deepEqual(
      after.messages.map((m) => m.body),
      ['Where is my paper?', 'thanks'],
    );
  });

  it('is not found to another student', async () => {
    const owner = await makeStudent(prisma);
    const stranger = await makeStudent(prisma);
    const ticket = await ask(owner.id);
    await assert.rejects(
      support.detailMine(stranger.id, ticket.id),
      (e) => codeOf(e) === ErrorCodes.NOT_FOUND,
    );
  });

  it('refuses a sitting that is not the student’s own', async () => {
    const owner = await makeStudent(prisma);
    const stranger = await makeStudent(prisma);
    const test = await makeTest(prisma, await makeCatalog(prisma));
    const theirs = await makeSitting(prisma, { testId: test.id, studentId: owner.id, score: 10 });
    await assert.rejects(
      support.create(stranger.id, {
        category: SUPPORT_CATEGORIES.TEST_OR_RESULT,
        attemptId: theirs.id,
        body: 'wrong mark',
      }),
      (e) => codeOf(e) === ErrorCodes.NOT_FOUND,
    );
  });

  it('refuses an attachment key from another ticket', async () => {
    const { id: studentId } = await makeStudent(prisma);
    const mine = await ask(studentId);
    await assert.rejects(
      support.replyAsStudent(studentId, mine.id, {
        body: 'see image',
        attachmentKey: 'support/t/another-ticket/x.png',
      }),
      (e) => codeOf(e) === ErrorCodes.VALIDATION_ERROR,
    );
  });

  it('refuses an upload to another student’s ticket', async () => {
    const owner = await makeStudent(prisma);
    const stranger = await makeStudent(prisma);
    const theirs = await ask(owner.id);
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c70000000049454e44ae426082',
      'hex',
    );
    await assert.rejects(
      support.uploadForStudent(stranger.id, theirs.id, {
        buffer: png,
        size: png.length,
        mimetype: 'image/png',
      }),
      (e) => codeOf(e) === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('admins working the queue', () => {
  beforeEach(() => {
    sender.sent.length = 0;
  });

  const studentWith = async (opts: { email?: string; push?: boolean } = {}) => {
    const student = await makeStudent(prisma);
    if (opts.email) {
      await prisma.studentProfile.create({ data: { studentId: student.id, email: opts.email } });
    }
    if (opts.push) {
      await prisma.pushDevice.create({
        data: { studentId: student.id, token: `t-${student.id}`, platform: 'ANDROID' },
      });
    }
    return student;
  };

  it('a public reply answers the ticket and claims it for the replier', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith();
    const ticket = await ask(studentId);
    const after = await admins.reply(admin.id, ticket.id, { body: 'Fixed.', internal: false });
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(after.status, 'ANSWERED');
    assert.ok(row.answeredAt);
    assert.equal(row.assigneeId, admin.id);
  });

  it('an internal note changes no status and never reaches the student', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith();
    const ticket = await ask(studentId);
    await admins.reply(admin.id, ticket.id, { body: 'SECRET-NOTE', internal: true });
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(row.status, 'OPEN');
    assert.equal(row.answeredAt, null);
    const mine = await support.detailMine(studentId, ticket.id);
    assert.ok(!mine.messages.some((m) => m.body === 'SECRET-NOTE'));
    assert.equal((await admins.detail(ticket.id)).messages.length, 2);
  });

  it('a public reply writes one bell row that does not carry the internal note', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith({ push: true });
    const ticket = await ask(studentId);
    await admins.reply(admin.id, ticket.id, { body: 'SECRET-NOTE', internal: true });
    await admins.reply(admin.id, ticket.id, { body: 'Public answer', internal: false });
    const rows = await prisma.notification.findMany({ where: { studentId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.type, 'SUPPORT_REPLY');
    assert.equal((rows[0]?.data as { ticketId: string }).ticketId, ticket.id);
    assert.ok(!JSON.stringify(rows[0]).includes('SECRET-NOTE'));
  });

  it('emails only a student with nothing to push to', async () => {
    const admin = await makeAdmin(prisma);
    const pushed = await studentWith({ email: 'a@x.test', push: true });
    const unreachable = await studentWith({ email: 'b@x.test' });
    const noAddress = await studentWith();
    for (const s of [pushed, unreachable, noAddress]) {
      const t = await ask(s.id);
      await admins.reply(admin.id, t.id, { body: 'Hello', internal: false });
    }
    assert.deepEqual(
      sender.sent.map((m) => m.to),
      ['b@x.test'],
    );
  });

  it('emails an unlinked ticket once and closes it', async () => {
    const admin = await makeAdmin(prisma);
    const ticket = await prisma.supportTicket.create({
      data: {
        category: 'LOGIN_OR_ACCOUNT',
        contactEmail: 'c@x.test',
        messages: { create: { authorType: 'STUDENT', body: 'locked out' } },
      },
    });
    const after = await admins.reply(admin.id, ticket.id, { body: 'Try now', internal: false });
    assert.equal(after.status, 'CLOSED');
    assert.deepEqual(
      sender.sent.map((m) => m.to),
      ['c@x.test'],
    );
  });

  it('a failed email is flagged on the message and does not undo the reply', async () => {
    const admin = await makeAdmin(prisma);
    const down = new SupportAdminService(
      prisma,
      new FakeStorage() as never,
      new NotificationsService(prisma),
      new FakeMessageSender(['email']),
    );
    const { id: studentId } = await studentWith({ email: 'd@x.test' });
    const ticket = await ask(studentId);
    const after = await down.reply(admin.id, ticket.id, { body: 'Hello', internal: false });
    assert.equal(after.status, 'ANSWERED');
    const flagged = after.messages.find((m) => m.fromStaff);
    assert.ok(flagged?.emailFailedAt);
    const again = await admins.resendEmail(ticket.id, flagged.id);
    assert.equal(again.messages.length, 2);
    assert.deepEqual(
      sender.sent.map((m) => m.to),
      ['d@x.test'],
    );
  });

  it('refuses a reply to a closed ticket', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith();
    const ticket = await ask(studentId);
    await admins.close(ticket.id);
    await assert.rejects(
      admins.reply(admin.id, ticket.id, { body: 'late', internal: false }),
      (e) => codeOf(e) === ErrorCodes.TICKET_CLOSED,
    );
  });

  it('lists HIGH first then oldest, and filters by assignee', async () => {
    const me = await makeAdmin(prisma);
    const other = await makeAdmin(prisma);
    const a = await studentWith();
    const old = await ask(a.id);
    const newer = await ask(a.id);
    const urgent = await ask(a.id);
    await prisma.supportTicket.update({
      where: { id: old.id },
      data: { lastMessageAt: new Date(Date.now() - 60_000), assigneeId: me.id },
    });
    await prisma.supportTicket.update({ where: { id: urgent.id }, data: { priority: 'HIGH' } });
    const unlinked = await prisma.supportTicket.create({
      data: { category: 'OTHER', assigneeId: other.id },
    });
    const page = { page: 1, pageSize: 20 };
    const ids = async (assignee?: string) =>
      (await admins.list(me.id, { ...page, assignee })).items.map((t) => t.id);
    assert.deepEqual((await ids()).slice(0, 2), [urgent.id, old.id]);
    assert.deepEqual(await ids('mine'), [old.id]);
    assert.deepEqual(await ids('unlinked'), [unlinked.id]);
    assert.ok(!(await ids('unclaimed')).includes(old.id));
    assert.ok((await ids('unclaimed')).includes(newer.id));
    assert.equal(await admins.unclaimedCount(), 2);
  });
});
