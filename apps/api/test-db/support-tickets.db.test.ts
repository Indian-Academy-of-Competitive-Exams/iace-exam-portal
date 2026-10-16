import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, SUPPORT_CATEGORIES } from '@iace/contracts';
import { SupportService } from '../src/support/support.service';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
} from './support/database';
import { FakeStorage } from '../test/support/fakes';

const prisma = testPrisma();
const support = new SupportService(prisma, new FakeStorage() as never);
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
