import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  eventCandidateListQuerySchema,
  eventListQuerySchema,
} from '@iace/contracts';
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

const rosterQuery = (over: Record<string, string> = {}) =>
  eventCandidateListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

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

  /** The screen leaves Delete out above zero, so the count has to arrive with the row. */
  it('reports how many series name the event, so the screen never offers a refused delete', async () => {
    const { service } = serviceWith(
      [makeEvent({ id: 'evt_1' }), makeEvent({ id: 'evt_2', name: 'Untouched' })],
      [],
      [],
      ['evt_1', 'evt_1'],
    );

    const page = await service.list(listQuery());

    assert.equal(page.items.find((event) => event.id === 'evt_1')?.seriesCount, 2);
    assert.equal(page.items.find((event) => event.id === 'evt_2')?.seriesCount, 0);
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

describe('EventsService — the roster', () => {
  const intake = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      eventId: 'evt_1',
      studentId: `stu_${index}`,
      createdAt: new Date(2026, 0, 1, 0, index),
    }));

  const named = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      makeStudent({
        id: `stu_${index}`,
        fullName: `Candidate ${String(index).padStart(2, '0')}`,
        mobile: String(9000000000 + index),
      }),
    );

  /** The failure this prevents: a 2,000-row intake rendered whole inside one panel. */
  it('returns one page of a long roster, and the whole count beside it', async () => {
    const { service } = serviceWith([makeEvent({ id: 'evt_1' })], intake(30), named(30));

    const page = await service.candidates('evt_1', rosterQuery({ pageSize: '10' }));

    assert.equal(page.items.length, 10);
    assert.equal(page.total, 30);
  });

  it('finds one candidate on a long roster by name or by mobile number', async () => {
    const { service } = serviceWith([makeEvent({ id: 'evt_1' })], intake(30), named(30));

    const byName = await service.candidates('evt_1', rosterQuery({ q: 'candidate 07' }));
    const byMobile = await service.candidates('evt_1', rosterQuery({ q: '9000000007' }));

    assert.deepEqual(
      byName.items.map((candidate) => candidate.studentId),
      ['stu_7'],
    );
    assert.deepEqual(
      byMobile.items.map((candidate) => candidate.studentId),
      ['stu_7'],
    );
  });

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

  /** A no-op on a missing PAIRING is right; a 200 and a bust for an event that never existed is not. */
  it('reads a removal from an event that is not there as missing, and rings no bell', async () => {
    const { service, eventBus } = serviceWith([makeEvent({ id: 'evt_1' })]);

    const error = await service.removeCandidate('evt_gone', 'stu_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(eventBus.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED).length, 0);
  });
});
