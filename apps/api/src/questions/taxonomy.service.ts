import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  type CreateSubjectBody,
  type CreateTopicBody,
  type Paginated,
  type Subject,
  type SubjectListQuery,
  type Topic,
  type TopicListQuery,
  type UpdateSubjectBody,
  type UpdateTopicBody,
} from '@iace/contracts';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { everyTermMatches } from '../common/search-terms';
import { countsBy } from '../common/relation-counts';

const TOPIC_INCLUDE = {
  subject: { select: { id: true, name: true } },
} as const satisfies Prisma.TopicInclude;

const SUBJECT_SELECT = { id: true, name: true, code: true } as const satisfies Prisma.SubjectSelect;

type SubjectRow = Prisma.SubjectGetPayload<{ select: typeof SUBJECT_SELECT }>;
type TopicRow = Prisma.TopicGetPayload<{ include: typeof TOPIC_INCLUDE }>;

interface SubjectCounts {
  topics: number;
  questions: number;
}

/** A row nothing points at yet — a subject or topic created a statement ago. */
const NOTHING_YET: SubjectCounts = { topics: 0, questions: 0 };

function counted(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Said in the refusal: every holder that still has a hand on the row, each with its count. */
function stillUsedBy(name: string, holders: (string | null)[]): string | null {
  const held = holders.filter((part): part is string => part !== null);
  if (held.length === 0) return null;
  return `${name} is still used by ${held.join(', ')}. Re-file or remove those first.`;
}

/** What each taxonomy level's audit diff covers — one `AuditFeature` value per level. */
export const AUDITED_SUBJECT_FIELDS = ['name', 'code'] as const;
export const AUDITED_TOPIC_FIELDS = ['name'] as const;

/** Owns `Subject` and `Topic` (docs/03 §5). Names arrive canonical from the schemas, so a case- or space-different duplicate cannot be created. Anything finer than a topic is a `topic:` tag on the question, not a row here. */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
  ) {}

  // ==========================================================================
  // Subjects
  // ==========================================================================

  async listSubjects(query: SubjectListQuery): Promise<Paginated<Subject>> {
    const where = everyTermMatches<Prisma.SubjectWhereInput>(query.q, (term) => [
      { name: { contains: term, mode: 'insensitive' } },
    ]);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subject.findMany({
        where,
        select: SUBJECT_SELECT,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.subject.count({ where }),
    ]);

    const counts = await this.subjectCounts(rows.map((row) => row.id));
    return paged(
      query,
      rows.map((row) => toSubject(row, counts.get(row.id) ?? NOTHING_YET)),
      total,
    );
  }

  /** The page's own subjects: a relation `_count` would group the whole bank for each of them. */
  private async subjectCounts(ids: readonly string[]): Promise<Map<string, SubjectCounts>> {
    if (ids.length === 0) return new Map();
    const where = { subjectId: { in: [...ids] } };
    const [topics, questions] = await Promise.all([
      this.prisma.topic.groupBy({ by: ['subjectId'], where, _count: true }),
      this.prisma.question.groupBy({ by: ['subjectId'], where, _count: true }),
    ]);
    const under = countsBy(topics, 'subjectId');
    const asked = countsBy(questions, 'subjectId');
    return new Map(
      ids.map((id) => [id, { topics: under.get(id) ?? 0, questions: asked.get(id) ?? 0 }]),
    );
  }

  /** One topic's questions, counted off `Question_topicId_idx` rather than the whole bank. */
  private async topicCounts(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    return countsBy(
      await this.prisma.question.groupBy({
        by: ['topicId'],
        where: { topicId: { in: [...ids] } },
        _count: true,
      }),
      'topicId',
    );
  }

  async createSubject(body: CreateSubjectBody): Promise<Subject> {
    const taken = await this.prisma.subject.findUnique({ where: { name: body.name } });
    if (taken) {
      throw new AppException(ErrorCodes.CONFLICT, `${body.name} already exists`, {
        fieldErrors: { name: [`${body.name} already exists`] },
      });
    }

    return toSubject(
      await this.prisma.subject.create({
        data: { name: body.name, code: body.code ?? null },
        select: SUBJECT_SELECT,
      }),
      NOTHING_YET,
    );
  }

  async updateSubject(id: string, body: UpdateSubjectBody): Promise<Subject> {
    const subject = await this.requireSubject(id);

    if (body.name !== undefined) {
      const taken = await this.prisma.subject.findFirst({
        where: { name: body.name, id: { not: id } },
      });
      if (taken) {
        throw new AppException(ErrorCodes.CONFLICT, `${body.name} already exists`, {
          fieldErrors: { name: [`${body.name} already exists`] },
        });
      }
    }

    const changes = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.code === undefined ? {} : { code: body.code }),
    };

    const updated = await this.prisma.subject.update({
      where: { id },
      data: changes,
      select: SUBJECT_SELECT,
    });

    this.auditContext.setPatchDiff(
      fieldDiff(subject, { ...subject, ...changes }, AUDITED_SUBJECT_FIELDS),
    );

    return toSubject(updated, (await this.subjectCounts([id])).get(id) ?? NOTHING_YET);
  }

  /** Deleted only while nothing carries it: each holder is counted, and the refusal names them. */
  async removeSubject(id: string): Promise<void> {
    const subject = await this.requireSubject(id);

    const where = { subjectId: id };
    const [topics, questions, sections, statistics] = await Promise.all([
      this.prisma.topic.count({ where }),
      this.prisma.question.count({ where }),
      this.prisma.baseConfigSection.count({ where }),
      this.prisma.studentSubjectStat.count({ where }),
    ]);

    const blocker = stillUsedBy(subject.name, [
      counted(topics, 'topic'),
      counted(questions, 'question'),
      counted(sections, 'base configuration section'),
      counted(statistics, 'student subject statistic'),
    ]);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.subject.delete({ where: { id } });
  }

  // ==========================================================================
  // Topics
  // ==========================================================================

  async listTopics(query: TopicListQuery): Promise<Paginated<Topic>> {
    const where: Prisma.TopicWhereInput = {
      ...everyTermMatches<Prisma.TopicWhereInput>(query.q, (term) => [
        { name: { contains: term, mode: 'insensitive' } },
      ]),
      ...(query.subjectId ? { subjectId: { in: query.subjectId } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        where,
        include: TOPIC_INCLUDE,
        orderBy: [{ subject: { name: 'asc' } }, { name: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.topic.count({ where }),
    ]);

    const counts = await this.topicCounts(rows.map((row) => row.id));
    return paged(
      query,
      rows.map((row) => toTopic(row, counts.get(row.id) ?? 0)),
      total,
    );
  }

  async createTopic(body: CreateTopicBody): Promise<Topic> {
    await this.requireSubject(body.subjectId);

    const taken = await this.prisma.topic.findFirst({
      where: { subjectId: body.subjectId, name: body.name },
    });
    if (taken) {
      throw new AppException(ErrorCodes.CONFLICT, `${body.name} already exists in that subject`, {
        fieldErrors: { name: [`${body.name} already exists in that subject`] },
      });
    }

    return toTopic(
      await this.prisma.topic.create({
        data: { subjectId: body.subjectId, name: body.name },
        include: TOPIC_INCLUDE,
      }),
      0,
    );
  }

  /** A topic never moves subject — every question under it would change meaning. */
  async updateTopic(id: string, body: UpdateTopicBody): Promise<Topic> {
    const topic = await this.requireTopic(id);

    const taken = await this.prisma.topic.findFirst({
      where: { subjectId: topic.subjectId, name: body.name, id: { not: id } },
    });
    if (taken) {
      throw new AppException(ErrorCodes.CONFLICT, `${body.name} already exists in that subject`, {
        fieldErrors: { name: [`${body.name} already exists in that subject`] },
      });
    }

    const changes = { name: body.name };

    const updated = await this.prisma.topic.update({
      where: { id },
      data: changes,
      include: TOPIC_INCLUDE,
    });

    this.auditContext.setPatchDiff(
      fieldDiff(topic, { ...topic, ...changes }, AUDITED_TOPIC_FIELDS),
    );

    return toTopic(updated, (await this.topicCounts([id])).get(id) ?? 0);
  }

  /** Deleted only while nothing carries it: the questions filed under it, and the draw settings that name it. */
  async removeTopic(id: string): Promise<void> {
    const topic = await this.requireTopic(id);

    const [questions, draws] = await Promise.all([
      this.prisma.question.count({ where: { topicId: id } }),
      this.testsDrawingFrom(id),
    ]);

    const blocker = stillUsedBy(topic.name, [
      counted(questions, 'question'),
      counted(draws, 'test that draws from it'),
    ]);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);

    await this.prisma.topic.delete({ where: { id } });
  }

  /** A draw setting keeps topic ids inside JSON, where no foreign key can see them. */
  private async testsDrawingFrom(topicId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "Test"
      WHERE jsonb_path_exists(
        "questionPoolFilter",
        '$.sections.*.topicIds[*] ? (@ == $topic)',
        jsonb_build_object('topic', ${topicId}::text)
      )`;
    return Number(row?.count ?? 0);
  }

  // ==========================================================================

  private async requireSubject(id: string) {
    const row = await this.prisma.subject.findUnique({ where: { id } });
    if (!row) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'No such subject', {
        fieldErrors: { subjectId: ['No such subject'] },
      });
    }
    return row;
  }

  private async requireTopic(id: string) {
    const row = await this.prisma.topic.findUnique({ where: { id } });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such topic');
    return row;
  }
}

function toSubject(row: SubjectRow, counts: SubjectCounts): Subject {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    topicCount: counts.topics,
    questionCount: counts.questions,
  };
}

function toTopic(row: TopicRow, questionCount: number): Topic {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    questionCount,
  };
}
