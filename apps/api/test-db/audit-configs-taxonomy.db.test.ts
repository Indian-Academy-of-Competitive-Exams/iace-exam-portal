import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DEFAULT_EXAM_COURSE } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { ExamsService } from '../src/configs/exams.service';
import { TaxonomyService } from '../src/questions/taxonomy.service';
import { StudentsService } from '../src/students';
import { FakeEventBus, FakeQueue, fakeStartingPins } from '../test/support/fakes';
import { BANK, makeQuestionBank, resetDatabase, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Runs the edit inside a live AuditContext and hands back the diff it left, as the interceptor reads it. */
async function diffOf(audit: AuditContext, edit: () => Promise<unknown>) {
  return audit.run(async () => {
    await edit();
    return audit.current()?.changed;
  });
}

describe('ExamsService.update — driven live, the diff a real edit contributes', () => {
  it('reports a rename, and a re-save of the same name as nothing to log', async () => {
    await prisma.exam.create({
      data: { id: 'exam_1', course: DEFAULT_EXAM_COURSE, name: 'SSC CGL', code: 'SSC CGL' },
    });
    const audit = new AuditContext();
    const students = new StudentsService(
      prisma,
      null as never,
      null as never,
      null as never,
      fakeStartingPins(),
      null as never,
      new AuditContext(),
      new FakeEventBus().asService(),
      new NotificationOutbox(new FakeQueue().asQueue()),
    );
    const exams = new ExamsService(prisma, students, audit);

    const changed = await diffOf(audit, () => exams.update('exam_1', { name: 'SSC CGL TIER 1' }));

    assert.deepEqual(changed, { name: { from: 'SSC CGL', to: 'SSC CGL TIER 1' } });

    const resaved = await audit.run(async () => {
      await exams.update('exam_1', { name: 'SSC CGL TIER 1' });
      return audit.current()?.unchanged;
    });
    assert.equal(resaved, true);
  });
});

describe('TaxonomyService — driven live, the diff a real edit contributes', () => {
  it('reports a subject code change and a topic rename', async () => {
    await makeQuestionBank(prisma);
    const audit = new AuditContext();
    const taxonomy = new TaxonomyService(prisma, audit);

    const subject = await diffOf(audit, () => taxonomy.updateSubject(BANK.QUANT, { code: 'QA' }));
    const topic = await diffOf(audit, () =>
      taxonomy.updateTopic(BANK.ARITHMETIC, { name: 'ARITHMETIC BASICS' }),
    );

    assert.deepEqual(subject, { code: { from: null, to: 'QA' } });
    assert.deepEqual(topic, { name: { from: 'ARITHMETIC', to: 'ARITHMETIC BASICS' } });
  });
});
