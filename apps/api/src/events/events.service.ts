import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  type CreateEventBody,
  type Event,
  type EventListQuery,
  type Paginated,
  type UpdateEventBody,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { everyTermMatches } from '../common/search-terms';
import { countsBy } from '../common/relation-counts';
import { AuditContext } from '../audit';

export const AUDITED_EVENT_FIELDS = ['name', 'description', 'isActive'] as const;

type EventRow = Prisma.EventGetPayload<object>;

interface EventCounts {
  candidates: number;
  series: number;
}

/** An event created a statement ago: nothing can name it and nobody can be on its roster. */
const NOTHING_YET: EventCounts = { candidates: 0, series: 0 };

/** Owns `Event` and `EventCandidate` — who an EVENT series draws its roster from, candidate or not. */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
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
        orderBy: [{ name: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.event.count({ where }),
    ]);

    const counts = await this.countsOf(rows.map((row) => row.id));
    return paged(
      query,
      rows.map((row) => toEvent(row, counts.get(row.id) ?? NOTHING_YET)),
      total,
    );
  }

  /** The page's own events: a relation `_count` would group every candidate row for each read. */
  private async countsOf(ids: readonly string[]): Promise<Map<string, EventCounts>> {
    if (ids.length === 0) return new Map();
    const where = { eventId: { in: [...ids] } };
    const [candidates, series] = await Promise.all([
      this.prisma.eventCandidate.groupBy({ by: ['eventId'], where, _count: true }),
      this.prisma.testSeries.groupBy({ by: ['eventId'], where, _count: true }),
    ]);
    const roster = countsBy(candidates, 'eventId');
    const naming = countsBy(series, 'eventId');
    return new Map(
      ids.map((id) => [id, { candidates: roster.get(id) ?? 0, series: naming.get(id) ?? 0 }]),
    );
  }

  private async countsOfOne(id: string): Promise<EventCounts> {
    return (await this.countsOf([id])).get(id) ?? NOTHING_YET;
  }

  async detail(id: string): Promise<Event> {
    return toEvent(await this.requireEvent(id), await this.countsOfOne(id));
  }

  async create(input: CreateEventBody): Promise<Event> {
    const event = await this.prisma.event.create({
      data: { name: input.name, description: input.description ?? null },
    });
    return toEvent(event, NOTHING_YET);
  }

  async update(id: string, input: UpdateEventBody): Promise<Event> {
    const event = await this.requireEvent(id);

    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    const updated = await this.prisma.event.update({ where: { id }, data: changes });

    this.auditContext.setPatchDiff(
      fieldDiff(event, { ...event, ...changes }, AUDITED_EVENT_FIELDS),
    );

    return toEvent(updated, await this.countsOfOne(id));
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

  /** `skipDuplicates`, so re-importing the same roster over itself adds nobody twice. */
  async addCandidates(id: string, studentIds: readonly string[]): Promise<void> {
    await this.requireEvent(id);
    const before = await this.prisma.eventCandidate.count({ where: { eventId: id } });

    const { count } =
      studentIds.length > 0
        ? await this.prisma.eventCandidate.createMany({
            data: studentIds.map((studentId) => ({ eventId: id, studentId })),
            skipDuplicates: true,
          })
        : { count: 0 };
    this.auditContext.setPatchDiff(rosterDiff(before, before + count));
  }

  async removeCandidate(id: string, studentId: string): Promise<void> {
    await this.requireEvent(id);
    const before = await this.prisma.eventCandidate.count({ where: { eventId: id } });

    const { count } = await this.prisma.eventCandidate.deleteMany({
      where: { eventId: id, studentId },
    });
    this.auditContext.setPatchDiff(rosterDiff(before, before - count));
  }

  private async requireEvent(id: string): Promise<EventRow> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new AppException(ErrorCodes.NOT_FOUND, 'No such event');
    return event;
  }
}

/** A roster of thousands is a count in the log, not a list of every student on it. */
const rosterDiff = (from: number, to: number) =>
  fieldDiff({ candidates: from }, { candidates: to }, ['candidates']);

function toEvent(row: EventRow, counts: EventCounts): Event {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    candidateCount: counts.candidates,
    seriesCount: counts.series,
    createdAt: row.createdAt.toISOString(),
  };
}
