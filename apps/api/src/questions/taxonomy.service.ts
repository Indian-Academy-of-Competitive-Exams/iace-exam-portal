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
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';

const SUBJECT_INCLUDE = {
  _count: { select: { topics: true, questions: true } },
} as const satisfies Prisma.SubjectInclude;

const TOPIC_INCLUDE = {
  subject: { select: { id: true, name: true } },
  _count: { select: { questions: true } },
} as const satisfies Prisma.TopicInclude;

type SubjectRow = Prisma.SubjectGetPayload<{ include: typeof SUBJECT_INCLUDE }>;
type TopicRow = Prisma.TopicGetPayload<{ include: typeof TOPIC_INCLUDE }>;

/** What each taxonomy level's audit diff covers — one `AuditFeature` value per level. */
export const AUDITED_SUBJECT_FIELDS = ['name', 'code'] as const;
export const AUDITED_TOPIC_FIELDS = ['name'] as const;

/**
 * Owns `Subject` and `Topic` (docs/03 §5). Names arrive canonical from the schemas, so a
 * case- or space-different duplicate cannot be created. Anything finer than a topic is a
 * `topic:` tag on the question, not a row here.
 */
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
    const where: Prisma.SubjectWhereInput = query.q
      ? { name: { contains: query.q, mode: 'insensitive' } }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subject.findMany({
        where,
        include: SUBJECT_INCLUDE,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subject.count({ where }),
    ]);

    return { items: rows.map(toSubject), page: query.page, pageSize: query.pageSize, total };
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
        include: SUBJECT_INCLUDE,
      }),
    );
  }

  async updateSubject(id: string, body: UpdateSubjectBody): Promise<Subject> {
    const subject = await this.requireSubject(id);

    const changes = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.code === undefined ? {} : { code: body.code }),
    };

    const updated = await this.prisma.subject.update({
      where: { id },
      data: changes,
      include: SUBJECT_INCLUDE,
    });

    this.auditContext.setChanged(
      fieldDiff(subject, { ...subject, ...changes }, AUDITED_SUBJECT_FIELDS),
    );

    return toSubject(updated);
  }

  // ==========================================================================
  // Topics
  // ==========================================================================

  async listTopics(query: TopicListQuery): Promise<Paginated<Topic>> {
    const where: Prisma.TopicWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.subjectId ? { subjectId: { in: query.subjectId } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        where,
        include: TOPIC_INCLUDE,
        orderBy: [{ subject: { name: 'asc' } }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.topic.count({ where }),
    ]);

    return { items: rows.map(toTopic), page: query.page, pageSize: query.pageSize, total };
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

    this.auditContext.setChanged(fieldDiff(topic, { ...topic, ...changes }, AUDITED_TOPIC_FIELDS));

    return toTopic(updated);
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

function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    topicCount: row._count.topics,
    questionCount: row._count.questions,
  };
}

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    questionCount: row._count.questions,
  };
}
