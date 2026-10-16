import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ActorTypes, AppException, ErrorCodes, SUPPORT_CATEGORIES } from '@iace/contracts';
import { MS_PER_DAY, MS_PER_MINUTE } from '../src/common/time/units';
import { NotificationsService } from '../src/notifications';
import { PushService } from '../src/notifications/push.service';
import { redisKeys } from '../src/redis/redis.keys';
import { LoginHelpService } from '../src/support/login-help.service';
import { SupportAdminService } from '../src/support/support-admin.service';
import { SupportService } from '../src/support/support.service';
import {
  makeAdmin,
  makeBranch,
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
} from './support/database';
import {
  FakeConfig,
  FakeFcmSender,
  FakeMessageSender,
  FakePushSender,
  FakeRedis,
  FakeStorage,
} from '../test/support/fakes';

const prisma = testPrisma();
const support = new SupportService(prisma, new FakeStorage() as never);
const sender = new FakeMessageSender();
const redis = new FakeRedis();
const pushService = new PushService(
  prisma,
  new FakeConfig({
    VAPID_PUBLIC_KEY: 'BPublicKey',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:a@b.c',
  }).asService(),
  new FakePushSender() as never,
  new FakeFcmSender() as never,
  redis.asService(),
);
const adminsWith = (messages: FakeMessageSender) =>
  new SupportAdminService(
    prisma,
    new FakeStorage() as never,
    new NotificationsService(prisma),
    messages,
    pushService,
  );
const admins = adminsWith(sender);
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

  type PushKind = 'device' | 'subscription';
  const pushTo = async (studentId: string, kind: PushKind, live: boolean) => {
    const sessionId = randomUUID();
    if (live) {
      await redis
        .asService()
        .setJson(
          redisKeys.session(ActorTypes.STUDENT, studentId, sessionId),
          { client: null },
          3600,
        );
    }
    if (kind === 'device') {
      await prisma.pushDevice.create({
        data: { studentId, token: `t-${studentId}`, platform: 'ANDROID', sessionId },
      });
    } else {
      await prisma.pushSubscription.create({
        data: {
          studentId,
          endpoint: `https://fcm.googleapis.com/fcm/send/${studentId}`,
          p256dh: 'k',
          auth: 'a',
          sessionId,
        },
      });
    }
  };

  const studentWith = async (opts: { email?: string; push?: PushKind } = {}) => {
    const student = await makeStudent(prisma);
    if (opts.email) {
      await prisma.studentProfile.create({ data: { studentId: student.id, email: opts.email } });
    }
    if (opts.push) await pushTo(student.id, opts.push, true);
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
    const { id: studentId } = await studentWith({ push: 'device' });
    const ticket = await ask(studentId);
    await admins.reply(admin.id, ticket.id, { body: 'SECRET-NOTE', internal: true });
    await admins.reply(admin.id, ticket.id, { body: 'Public answer', internal: false });
    const rows = await prisma.notification.findMany({ where: { studentId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.type, 'SUPPORT_REPLY');
    assert.equal((rows[0]?.data as { ticketId: string }).ticketId, ticket.id);
    assert.ok(!JSON.stringify(rows[0]).includes('SECRET-NOTE'));
  });

  it('emails only a student with nothing live to push to, and still writes the bell row', async () => {
    const admin = await makeAdmin(prisma);
    const device = await studentWith({ email: 'a@x.test', push: 'device' });
    const browser = await studentWith({ email: 'e@x.test', push: 'subscription' });
    const unreachable = await studentWith({ email: 'b@x.test' });
    const dead = await studentWith({ email: 'f@x.test' });
    await pushTo(dead.id, 'device', false);
    const noAddress = await studentWith();
    for (const s of [device, browser, unreachable, dead, noAddress]) {
      const t = await ask(s.id);
      await admins.reply(admin.id, t.id, { body: 'Hello', internal: false });
    }
    assert.deepEqual(sender.sent.map((m) => m.to).sort(), ['b@x.test', 'f@x.test']);
    assert.equal(await prisma.notification.count({ where: { studentId: unreachable.id } }), 1);
  });

  it('emails the ticket contact address ahead of the profile address', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith({ email: 'profile@x.test' });
    const ticket = await ask(studentId);
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { contactEmail: 'contact@x.test' },
    });
    await admins.reply(admin.id, ticket.id, { body: 'Hello', internal: false });
    assert.deepEqual(
      sender.sent.map((m) => m.to),
      ['contact@x.test'],
    );
  });

  it('an internal note sends no email and writes no bell row', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith({ email: 'n@x.test' });
    const ticket = await ask(studentId);
    await admins.reply(admin.id, ticket.id, { body: 'note', internal: true });
    assert.equal(sender.sent.length, 0);
    assert.equal(await prisma.notification.count({ where: { studentId } }), 0);
  });

  it('refuses to reassign to an inactive admin', async () => {
    const gone = await makeAdmin(prisma, { isActive: false });
    const { id: studentId } = await studentWith();
    const ticket = await ask(studentId);
    await assert.rejects(
      admins.patch(ticket.id, { assigneeId: gone.id }),
      (e) => codeOf(e) === ErrorCodes.NOT_FOUND,
    );
  });

  it('refuses an attachment key from another ticket', async () => {
    const admin = await makeAdmin(prisma);
    const { id: studentId } = await studentWith();
    const ticket = await ask(studentId);
    await assert.rejects(
      admins.reply(admin.id, ticket.id, {
        body: 'see',
        internal: false,
        attachmentKey: 'support/t/another-ticket/x.png',
      }),
      (e) => codeOf(e) === ErrorCodes.VALIDATION_ERROR,
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
    const down = adminsWith(new FakeMessageSender(['email']));
    const { id: studentId } = await studentWith({ email: 'd@x.test' });
    const ticket = await ask(studentId);
    const after = await down.reply(admin.id, ticket.id, { body: 'Hello', internal: false });
    assert.equal(after.status, 'ANSWERED');
    const flagged = after.messages.find((m) => m.fromStaff);
    assert.ok(flagged?.emailFailedAt);
    const again = await admins.resendEmail(ticket.id, flagged.id);
    assert.equal(again.messages.length, 2);
    assert.equal(again.messages.find((m) => m.fromStaff)?.emailFailedAt, null);
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
    const linkedOf = async (id: string) =>
      (await admins.list(me.id, page)).items.find((t) => t.id === id)?.linked;
    assert.equal(await linkedOf(unlinked.id), false);
    assert.equal(await linkedOf(old.id), true);
    assert.ok(!(await ids('unclaimed')).includes(old.id));
    assert.ok((await ids('unclaimed')).includes(newer.id));
    assert.equal(await admins.unclaimedCount(), 2);
  });
});

describe('login help', () => {
  let loginHelp: LoginHelpService;
  beforeEach(() => {
    loginHelp = new LoginHelpService(prisma, new FakeRedis().asService());
  });
  const DOB = '2001-04-09';
  const claimFor = async (over: Record<string, unknown> = {}) => ({
    fullName: 'Asha Rao',
    registeredMobile: '9876500001',
    dob: DOB,
    fatherName: 'Ravi Rao',
    branchId: (await makeBranch(prisma)).id,
    contactEmail: 'asha@x.test',
    problem: 'OTP_NOT_ARRIVING' as const,
    body: 'No code arrives',
    ...over,
  });
  const student = async (mobile: string, dob: string | null = DOB, fullName = 'Asha Rao') => {
    const s = await makeStudent(prisma, { mobile, fullName });
    await prisma.studentProfile.create({
      data: { studentId: s.id, dob: dob ? new Date(`${dob}T00:00:00Z`) : null },
    });
    return s;
  };
  const lastTicket = () =>
    prisma.supportTicket.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });

  it('links a claim matching mobile, dob and name', async () => {
    const s = await student('9876500001');
    await loginHelp.submit(await claimFor(), '1.1.1.1');
    assert.equal((await lastTicket()).studentId, s.id);
  });

  it('links through a number the student used to have', async () => {
    const s = await student('9000000009');
    await prisma.studentMobileHistory.create({ data: { studentId: s.id, mobile: '9876500001' } });
    await loginHelp.submit(await claimFor(), '1.1.1.1');
    assert.equal((await lastTicket()).studentId, s.id);
  });

  it('leaves a wrong dob unlinked', async () => {
    await student('9876500001');
    await loginHelp.submit(await claimFor({ dob: '2001-04-10' }), '1.1.1.1');
    assert.equal((await lastTicket()).studentId, null);
  });

  it('leaves a student with no dob on file unlinked', async () => {
    await student('9876500001', null);
    await loginHelp.submit(await claimFor(), '1.1.1.1');
    assert.equal((await lastTicket()).studentId, null);
  });

  it('leaves an ambiguous claim unlinked', async () => {
    await student('9876500001');
    const other = await student('9000000009');
    await prisma.studentMobileHistory.create({
      data: { studentId: other.id, mobile: '9876500001' },
    });
    await loginHelp.submit(await claimFor(), '1.1.1.1');
    assert.equal((await lastTicket()).studentId, null);
  });

  it('answers a matched and an unmatched claim identically', async () => {
    await student('9876500001');
    const matched = await loginHelp.submit(await claimFor(), '1.1.1.1');
    const unmatched = await loginHelp.submit(
      await claimFor({ registeredMobile: '9876500002' }),
      '1.1.1.1',
    );
    assert.deepEqual(matched, unmatched);
  });

  it('refuses the 4th request for one registered mobile in a day', async () => {
    for (let i = 0; i < 3; i++) await loginHelp.submit(await claimFor(), `2.2.2.${i}`);
    await assert.rejects(
      async () => loginHelp.submit(await claimFor(), '2.2.2.9'),
      (e) => codeOf(e) === ErrorCodes.RATE_LIMITED,
    );
  });

  it('lists only active branches, and fills the admin claim check', async () => {
    const live = await makeBranch(prisma, 'Live branch');
    const dead = await makeBranch(prisma, 'Dead branch');
    await prisma.branch.update({ where: { id: dead.id }, data: { isActive: false } });
    assert.deepEqual(
      (await loginHelp.branches()).filter((b) => b.id === live.id || b.id === dead.id),
      [{ id: live.id, name: 'Live branch' }],
    );
    const s = await student('9876500001');
    await loginHelp.submit(
      await claimFor({ branchId: live.id, fatherName: 'Wrong Name' }),
      '3.3.3.3',
    );
    const detail = await admins.detail((await lastTicket()).id);
    assert.equal(s.id, detail.student?.id);
    assert.equal(detail.claim?.dob?.matches, true);
    assert.equal(detail.claim?.fullName?.matches, true);
    assert.equal(detail.claim?.fatherName?.matches, null);
    assert.equal(detail.claim?.branch?.claimed, 'Live branch');
  });

  it('a matched ticket whose student can be pushed to sends no email and stays answered', async () => {
    const s = await student('9876500001');
    const sessionId = randomUUID();
    await redis
      .asService()
      .setJson(redisKeys.session(ActorTypes.STUDENT, s.id, sessionId), { client: null }, 3600);
    await prisma.pushDevice.create({
      data: { studentId: s.id, token: `t-${s.id}`, platform: 'ANDROID', sessionId },
    });
    await loginHelp.submit(await claimFor(), '4.4.4.4');
    const admin = await makeAdmin(prisma);
    sender.sent.length = 0;
    const after = await admins.reply(admin.id, (await lastTicket()).id, {
      body: 'Try now',
      internal: false,
    });
    assert.equal(after.status, 'ANSWERED');
    assert.equal(sender.sent.length, 0);
  });
});

describe('auto-closing quiet tickets', () => {
  const NOW = new Date('2026-10-16T12:00:00.000Z');
  const answeredAgo = async (ms: number, status: 'OPEN' | 'ANSWERED' = 'ANSWERED') => {
    const { id: studentId } = await makeStudent(prisma);
    const { id } = await ask(studentId);
    await prisma.supportTicket.update({
      where: { id },
      data: { status, answeredAt: new Date(NOW.getTime() - ms) },
    });
    return id;
  };
  const statusOf = async (id: string) =>
    (await prisma.supportTicket.findUniqueOrThrow({ where: { id } })).status;

  it('closes an answered ticket quiet for four days and a minute', async () => {
    const id = await answeredAgo(4 * MS_PER_DAY + MS_PER_MINUTE);
    assert.equal(await support.closeStale(NOW), 1);
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    assert.equal(ticket.status, 'CLOSED');
    assert.deepEqual(ticket.closedAt, NOW);
  });

  it('leaves one answered three days and 23 hours ago', async () => {
    const id = await answeredAgo(3 * MS_PER_DAY + 23 * 60 * MS_PER_MINUTE);
    assert.equal(await support.closeStale(NOW), 0);
    assert.equal(await statusOf(id), 'ANSWERED');
  });

  it('never touches an open ticket, however old', async () => {
    const id = await answeredAgo(30 * MS_PER_DAY, 'OPEN');
    assert.equal(await support.closeStale(NOW), 0);
    assert.equal(await statusOf(id), 'OPEN');
  });
});
