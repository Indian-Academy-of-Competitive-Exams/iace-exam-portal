import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  TEST_SERIES_KIND,
  eventCandidateListQuerySchema,
  eventListQuerySchema,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import { EventsService } from '../src/events/events.service';
import { FakeEventBus } from '../test/support/fakes';
import { makeCatalog, makeStudent, resetDatabase, testPrisma, uid } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build() {
  const eventBus = new FakeEventBus();
  const audit = new AuditContext();
  return { eventBus, audit, service: new EventsService(prisma, eventBus.asService(), audit) };
}

const makeEvent = (name = 'Scholarship test') =>
  prisma.event.create({ data: { name }, select: { id: true } });

/** A series naming the event, which is what a delete must refuse around. Only FREE spans no stage. */
async function nameInSeries(eventId: string) {
  const { examStageId } = await makeCatalog(prisma);
  return prisma.testSeries.create({
    data: { name: uid(), kind: TEST_SERIES_KIND.EVENT, eventId, examStageId },
  });
}

/** `count` candidates, named and numbered in the order they joined. */
async function intake(eventId: string, count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const student = await makeStudent(prisma, {
      fullName: `Candidate ${String(index).padStart(2, '0')}`,
      mobile: String(9000000000 + index),
    });
    await prisma.eventCandidate.create({
      data: { eventId, studentId: student.id, createdAt: new Date(2026, 0, 1, 0, index) },
    });
    ids.push(student.id);
  }
  return ids;
}

const listQuery = () => eventListQuerySchema.parse({ page: '1', pageSize: '20' });

const rosterQuery = (over: Record<string, string> = {}) =>
  eventCandidateListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

describe('EventsService — listing', () => {
  it('reports each event with the number of candidates on its roster', async () => {
    const { service } = build();
    const event = await makeEvent();
    await intake(event.id, 2);

    const page = await service.list(listQuery());

    assert.equal(page.items[0]?.candidateCount, 2);
  });

  /** The screen leaves Delete out above zero, so the count has to arrive with the row. */
  it('reports how many series name the event, so the screen never offers a refused delete', async () => {
    const { service } = build();
    const named = await makeEvent('Named');
    const untouched = await makeEvent('Untouched');
    await nameInSeries(named.id);
    await nameInSeries(named.id);

    const page = await service.list(listQuery());

    assert.equal(page.items.find((event) => event.id === named.id)?.seriesCount, 2);
    assert.equal(page.items.find((event) => event.id === untouched.id)?.seriesCount, 0);
  });
});

describe('EventsService — deleting', () => {
  it('refuses to delete an event a series still names', async () => {
    const { service } = build();
    const event = await makeEvent();
    await nameInSeries(event.id);

    await assert.rejects(
      () => service.remove(event.id),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.match(error.message, /1 test series/);
        return true;
      },
    );
  });

  it('deletes an event no series names', async () => {
    const { service } = build();
    const event = await makeEvent();

    await service.remove(event.id);

    assert.equal(await prisma.event.count(), 0);
  });
});

describe('EventsService — the roster', () => {
  /** The failure this prevents: a 2,000-row intake rendered whole inside one panel. */
  it('returns one page of a long roster, and the whole count beside it', async () => {
    const { service } = build();
    const event = await makeEvent();
    await intake(event.id, 30);

    const page = await service.candidates(event.id, rosterQuery({ pageSize: '10' }));

    assert.equal(page.items.length, 10);
    assert.equal(page.total, 30);
  });

  it('finds one candidate on a long roster by name or by mobile number', async () => {
    const { service } = build();
    const event = await makeEvent();
    const roster = await intake(event.id, 30);

    const byName = await service.candidates(event.id, rosterQuery({ q: 'candidate 07' }));
    const byMobile = await service.candidates(event.id, rosterQuery({ q: '9000000007' }));

    assert.deepEqual(
      byName.items.map((candidate) => candidate.studentId),
      [roster[7]],
    );
    assert.deepEqual(
      byMobile.items.map((candidate) => candidate.studentId),
      [roster[7]],
    );
  });

  it('busts the catalog of a student added to an event', async () => {
    const { service, eventBus } = build();
    const event = await makeEvent();
    const student = await makeStudent(prisma);

    await service.addCandidates(event.id, [student.id]);

    assert.equal(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED).length, 1);
    assert.deepEqual(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED)[0], {
      studentId: student.id,
    });
  });

  it('adds a candidate twice without error, and keeps one row', async () => {
    const { service } = build();
    const event = await makeEvent();
    const student = await makeStudent(prisma);

    await service.addCandidates(event.id, [student.id]);
    await service.addCandidates(event.id, [student.id]);

    assert.equal(await prisma.eventCandidate.count(), 1);
  });

  it('busts the catalog of a student removed from an event', async () => {
    const { service, eventBus } = build();
    const event = await makeEvent();
    const [studentId = ''] = await intake(event.id, 1);

    await service.removeCandidate(event.id, studentId);

    assert.equal(await prisma.eventCandidate.count(), 0);
    assert.equal(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED).length, 1);
  });

  /** A no-op on a missing PAIRING is right; a 200 and a bust for an event that never existed is not. */
  it('reads a removal from an event that is not there as missing, and rings no bell', async () => {
    const { service, eventBus } = build();
    const student = await makeStudent(prisma);

    const error = await service.removeCandidate(uid(), student.id).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED).length, 0);
  });
});

/** Runs the write inside a live AuditContext and hands back what the interceptor would read. */
async function auditOf(audit: AuditContext, write: () => Promise<unknown>) {
  return audit.run(async () => {
    await write();
    const store = audit.current();
    return { changed: store?.changed, unchanged: store?.unchanged };
  });
}

describe('EventsService — what each write leaves in the audit log', () => {
  it('reports a rename, and a save that changed nothing as nothing to log', async () => {
    const { service, audit } = build();
    const event = await makeEvent('Scholarship test');

    const renamed = await auditOf(audit, () =>
      service.update(event.id, { name: 'Scholarship test 2026' }),
    );
    const resaved = await auditOf(audit, () =>
      service.update(event.id, { name: 'Scholarship test 2026', isActive: true }),
    );

    assert.deepEqual(renamed, {
      changed: { name: { from: 'Scholarship test', to: 'Scholarship test 2026' } },
      unchanged: false,
    });
    assert.deepEqual(resaved, { changed: null, unchanged: true });
  });

  it('counts the roster a change moved, and leaves nothing for a re-import that added nobody', async () => {
    const { service, audit } = build();
    const event = await makeEvent();
    const [kept = ''] = await intake(event.id, 2);
    const newcomer = await makeStudent(prisma, { mobile: '9100000000' });

    const added = await auditOf(audit, () => service.addCandidates(event.id, [kept, newcomer.id]));
    const again = await auditOf(audit, () => service.addCandidates(event.id, [kept]));
    const removed = await auditOf(audit, () => service.removeCandidate(event.id, kept));

    assert.deepEqual(added.changed, { candidates: { from: 2, to: 3 } });
    assert.equal(again.unchanged, true);
    assert.deepEqual(removed.changed, { candidates: { from: 3, to: 2 } });
  });
});
