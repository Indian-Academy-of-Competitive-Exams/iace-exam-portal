import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  fieldDiff,
  type CreateSubTopicBody,
  type CreateSubjectBody,
  type CreateTopicBody,
  type Paginated,
  type SubTopic,
  type SubTopicListQuery,
  type Subject,
  type SubjectListQuery,
  type Topic,
  type TopicListQuery,
  type UpdateSubTopicBody,
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
  _count: { select: { subTopics: true, questions: true } },
} as const satisfies Prisma.TopicInclude;

const SUB_TOPIC_INCLUDE = {
  topics: { select: { id: true, name: true, subject: { select: { id: true, name: true } } } },
  _count: { select: { questions: true } },
} as const satisfies Prisma.SubTopicInclude;

type SubjectRow = Prisma.SubjectGetPayload<{ include: typeof SUBJECT_INCLUDE }>;
type TopicRow = Prisma.TopicGetPayload<{ include: typeof TOPIC_INCLUDE }>;
type SubTopicRow = Prisma.SubTopicGetPayload<{ include: typeof SUB_TOPIC_INCLUDE }>;

/** What each taxonomy level's audit diff covers — one `AuditFeature` value per level. */
export const AUDITED_SUBJECT_FIELDS = ['name', 'code'] as const;
export const AUDITED_TOPIC_FIELDS = ['name'] as const;
export const AUDITED_SUB_TOPIC_FIELDS = ['name', 'topicIds'] as const;

/**
 * Owns `Subject`, `Topic` and `SubTopic` (docs/03 §5). Names arrive canonical
 * from the schemas, so a case- or space-different duplicate cannot be created —
 * and a sub-topic is MATCHED before it is created, because its name is unique
 * table-wide and a second row would split the analytics the sharing joins up.
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
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
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
  // Sub-topics — the shared level
  // ==========================================================================

  async listSubTopics(query: SubTopicListQuery): Promise<Paginated<SubTopic>> {
    const where: Prisma.SubTopicWhereInput = {
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.topicId ? { topics: { some: { id: query.topicId } } } : {}),
      // A sub-topic reaches a subject only through a topic in it. That is the
      // whole shape of the third level, so the filter has to travel the same way.
      ...(query.subjectId ? { topics: { some: { subjectId: query.subjectId } } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subTopic.findMany({
        where,
        include: SUB_TOPIC_INCLUDE,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subTopic.count({ where }),
    ]);

    return { items: rows.map(toSubTopic), page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Creating one is really "link this name to these topics": the name is unique
   * across the table, so an existing row is linked rather than duplicated. That
   * is the difference between PERCENTAGES appearing under Arithmetic and Data
   * Interpretation, and two PERCENTAGES rows whose analytics never join.
   */
  async createSubTopic(body: CreateSubTopicBody): Promise<SubTopic> {
    await this.requireTopics(body.topicIds);

    const existing = await this.prisma.subTopic.findUnique({ where: { name: body.name } });
    if (existing) {
      return toSubTopic(
        await this.prisma.subTopic.update({
          where: { id: existing.id },
          data: { topics: { connect: body.topicIds.map((id) => ({ id })) } },
          include: SUB_TOPIC_INCLUDE,
        }),
      );
    }

    return toSubTopic(
      await this.prisma.subTopic.create({
        data: { name: body.name, topics: { connect: body.topicIds.map((id) => ({ id })) } },
        include: SUB_TOPIC_INCLUDE,
      }),
    );
  }

  /** `topicIds` REPLACES the links: the screen holds the whole set, not a delta. */
  async updateSubTopic(id: string, body: UpdateSubTopicBody): Promise<SubTopic> {
    const subTopic = await this.requireSubTopic(id);
    if (body.topicIds) await this.requireTopics(body.topicIds);

    if (body.name) {
      const taken = await this.prisma.subTopic.findFirst({
        where: { name: body.name, id: { not: id } },
      });
      if (taken) {
        throw new AppException(
          ErrorCodes.CONFLICT,
          `${body.name} already exists — link that one to this topic instead`,
          { fieldErrors: { name: [`${body.name} already exists`] } },
        );
      }
    }

    const changes = {
      ...(body.name ? { name: body.name } : {}),
      ...(body.topicIds
        ? { topics: { set: body.topicIds.map((topicId) => ({ id: topicId })) } }
        : {}),
    };

    const updated = await this.prisma.subTopic.update({
      where: { id },
      data: changes,
      include: SUB_TOPIC_INCLUDE,
    });

    this.auditContext.setChanged(
      fieldDiff(
        auditFieldsOfSubTopic(subTopic),
        auditFieldsOfSubTopic(updated),
        AUDITED_SUB_TOPIC_FIELDS,
      ),
    );

    return toSubTopic(updated);
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

  private async requireSubTopic(id: string) {
    const row = await this.prisma.subTopic.findUnique({
      where: { id },
      include: { topics: { select: { id: true } } },
    });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such sub-topic');
    return row;
  }

  private async requireTopics(ids: string[]): Promise<void> {
    const found = await this.prisma.topic.count({ where: { id: { in: ids } } });
    if (found === new Set(ids).size) return;

    throw new AppException(ErrorCodes.NOT_FOUND, 'One of those topics no longer exists', {
      fieldErrors: { topicIds: ['One of those topics no longer exists'] },
    });
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
    subTopicCount: row._count.subTopics,
    questionCount: row._count.questions,
  };
}

function toSubTopic(row: SubTopicRow): SubTopic {
  return {
    id: row.id,
    name: row.name,
    topics: row.topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      subject: topic.subject,
    })),
    questionCount: row._count.questions,
  };
}

/** `topics`, the M:N relation, flattened to ids — sorted so an unchanged set never reads as a
 * reorder. Not `localeCompare`: two machines must never order the same id set differently. */
function auditFieldsOfSubTopic(row: { name: string; topics: { id: string }[] }): {
  name: string;
  topicIds: string[];
} {
  return { name: row.name, topicIds: row.topics.map((topic) => topic.id).sort(byCodeUnit) };
}

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
