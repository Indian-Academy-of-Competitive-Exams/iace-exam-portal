import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  type CreateEventBody,
  type Event,
  type EventCandidate,
  type EventListQuery,
  type Paginated,
  type UpdateEventBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { everyTermMatches } from '../common/search-terms';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';

const EVENT_INCLUDE = {
  _count: { select: { candidates: true } },
} as const satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

type CandidateRow = Prisma.EventCandidateGetPayload<{
  include: { student: { select: { fullName: true; mobile: true } } };
}>;

/** Owns `Event` and `EventCandidate` — who an EVENT series draws its roster from, candidate or not. */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  async list(query: EventListQuery): Promise<Paginated<Event>> {
    const where: Prisma.EventWhereInput = {
      ...everyTermMatches<Prisma.EventWhereInput>(query.q, (term) => [
        { name: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ]),
      ...(query.activeOnly ? { isActive: true } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: EVENT_INCLUDE,
        orderBy: [{ name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.event.count({ where }),
    ]);

    return { items: rows.map(toEvent), page: query.page, pageSize: query.pageSize, total };
  }

  async detail(id: string): Promise<Event> {
    return toEvent(await this.requireEvent(id));
  }

  async create(input: CreateEventBody): Promise<Event> {
    const event = await this.prisma.event.create({
      data: { name: input.name, description: input.description ?? null },
      include: EVENT_INCLUDE,
    });
    return toEvent(event);
  }

  async update(id: string, input: UpdateEventBody): Promise<Event> {
    await this.requireEvent(id);

    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    const updated = await this.prisma.event.update({
      where: { id },
      data: changes,
      include: EVENT_INCLUDE,
    });
    return toEvent(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireEvent(id);

    const named = await this.prisma.testSeries.count({ where: { eventId: id } });
    if (named > 0) {
      const verb = named === 1 ? 'names' : 'name';
      const pronoun = named === 1 ? 'it' : 'them';
      throw new AppException(
        ErrorCodes.CONFLICT,
        `${named} test series still ${verb} this event. Point ${pronoun} elsewhere first.`,
      );
    }

    await this.prisma.event.delete({ where: { id } });
  }

  async candidates(id: string): Promise<EventCandidate[]> {
    await this.requireEvent(id);

    const rows = await this.prisma.eventCandidate.findMany({
      where: { eventId: id },
      include: { student: { select: { fullName: true, mobile: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });

    return rows.map(toCandidate);
  }

  /** `skipDuplicates`, so re-importing the same roster over itself adds nobody twice. */
  async addCandidates(id: string, studentIds: readonly string[]): Promise<EventCandidate[]> {
    await this.requireEvent(id);

    if (studentIds.length > 0) {
      await this.prisma.eventCandidate.createMany({
        data: studentIds.map((studentId) => ({ eventId: id, studentId })),
        skipDuplicates: true,
      });
      // Per student, not one global bust — an intake must not throw away every other catalog.
      for (const studentId of studentIds) {
        this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
      }
    }

    return this.candidates(id);
  }

  async removeCandidate(id: string, studentId: string): Promise<void> {
    await this.requireEvent(id);

    await this.prisma.eventCandidate.deleteMany({ where: { eventId: id, studentId } });
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
  }

  private async requireEvent(id: string): Promise<EventRow> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });
    if (!event) throw new AppException(ErrorCodes.NOT_FOUND, 'No such event');
    return event;
  }
}

function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    candidateCount: row._count.candidates,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCandidate(row: CandidateRow): EventCandidate {
  return {
    studentId: row.studentId,
    fullName: row.student.fullName,
    mobile: row.student.mobile,
    addedAt: row.createdAt.toISOString(),
  };
}
