import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, eventListQuerySchema } from '@iace/contracts';
import { DOMAIN_EVENTS } from '../src/common/events';
import { EventsService } from '../src/events/events.service';
import {
  FakeEventBus,
  FakeEventsPrisma,
  makeEvent,
  makeStudent,
  type FakeEventCandidateRow,
  type FakeEventRow,
  type FakeStudent,
} from './support/fakes';

function serviceWith(
  events: FakeEventRow[] = [makeEvent()],
  candidateRows: FakeEventCandidateRow[] = [],
  students: FakeStudent[] = [],
  seriesEventIds: string[] = [],
) {
  const prisma = new FakeEventsPrisma(events, candidateRows, students, seriesEventIds);
  const eventBus = new FakeEventBus();
  return {
    prisma,
    eventBus,
    service: new EventsService(prisma.asService(), eventBus.asService()),
  };
}

const listQuery = () => eventListQuerySchema.parse({ page: '1', pageSize: '20' });

describe('EventsService — listing', () => {
  it('reports each event with the number of candidates on its roster, from _count', async () => {
    const { service, prisma } = serviceWith(
      [makeEvent({ id: 'evt_1' })],
      [
        { eventId: 'evt_1', studentId: 'stu_1', createdAt: new Date('2026-01-02T00:00:00.000Z') },
        { eventId: 'evt_1', studentId: 'stu_2', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      ],
    );

    const page = await service.list(listQuery());

    assert.equal(page.items[0]?.candidateCount, 2);
    // The count comes off the row's own `_count`, not a second query per row.
    assert.equal(prisma.candidateRows.length, 2);
  });
});

describe('EventsService — deleting', () => {
  it('refuses to delete an event a series still names', async () => {
    const { service } = serviceWith([makeEvent({ id: 'evt_1' })], [], [], ['evt_1']);

    await assert.rejects(
      () => service.remove('evt_1'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        assert.match(error.message, /1 test series/);
        return true;
      },
    );
  });

  it('deletes an event no series names', async () => {
    const { service, prisma } = serviceWith([makeEvent({ id: 'evt_1' })]);

    await service.remove('evt_1');

    assert.equal(prisma.events.length, 0);
  });
});

describe('EventsService — candidates', () => {
  it('busts the catalog of a student added to an event', async () => {
    const { service, eventBus } = serviceWith(
      [makeEvent({ id: 'evt_1' })],
      [],
      [makeStudent({ id: 'stu_1' })],
    );

    await service.addCandidates('evt_1', ['stu_1']);

    assert.equal(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED).length, 1);
    assert.deepEqual(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED)[0], { studentId: 'stu_1' });
  });

  it('adds a candidate twice without error, and rings the bell only once each time', async () => {
    const { service, prisma } = serviceWith(
      [makeEvent({ id: 'evt_1' })],
      [],
      [makeStudent({ id: 'stu_1' })],
    );

    await service.addCandidates('evt_1', ['stu_1']);
    await service.addCandidates('evt_1', ['stu_1']);

    assert.equal(prisma.candidateRows.length, 1);
  });

  it('busts the catalog of a student removed from an event', async () => {
    const { service, eventBus, prisma } = serviceWith(
      [makeEvent({ id: 'evt_1' })],
      [{ eventId: 'evt_1', studentId: 'stu_1', createdAt: new Date('2026-01-02T00:00:00.000Z') }],
    );

    await service.removeCandidate('evt_1', 'stu_1');

    assert.equal(prisma.candidateRows.length, 0);
    assert.equal(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED).length, 1);
  });
});
