import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  QUESTION_SOURCE_KIND,
  plainTextOf,
  type LocalizedContent,
  type LocalizedRich,
  type Paginated,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionLanguage,
  type QuestionListQuery,
  type QuestionSummary,
  type QuestionSource,
  type SetQuestionActiveBody,
  type SetQuestionStatusBody,
  type ValidationIssue,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { buildContent, languagesIn, stemPreviewOf, validateQuestion } from './question-core';
import { questionOrderBy, questionWhere } from './question-query';
import { taxonomyForIds } from './taxonomy-context';

const QUESTION_INCLUDE = {
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  subTopic: { select: { id: true, name: true } },
  options: { orderBy: { position: 'asc' } },
} as const satisfies Prisma.QuestionInclude;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/** Owns `Question` and `QuestionOption` (docs/03 §5) — the only module that writes them. */
@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QuestionListQuery): Promise<Paginated<QuestionSummary>> {
    const matchedIds = query.q ? await this.searchIds(query.q) : null;
    const where = questionWhere(query, matchedIds);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: QUESTION_INCLUDE,
        orderBy: questionOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      items: rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(id: string): Promise<QuestionDetail> {
    return toDetail(await this.require(id));
  }

  async create(draft: QuestionDraft, createdById: string): Promise<QuestionDetail> {
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, null);

    const row = await this.prisma.question.create({
      data: {
        ...this.columnsOf(draft, built),
        createdById,
        source: { kind: QUESTION_SOURCE_KIND.MANUAL } satisfies QuestionSource,
        options: { create: built.options },
      },
      include: QUESTION_INCLUDE,
    });

    return toDetail(row);
  }

  /**
   * The options are replaced wholesale rather than diffed: an edit that reorders
   * or rewrites them has no stable identity to match on, and nothing has drawn
   * this question into a paper yet — a locked test copies its own PaperQuestion.
   */
  async update(id: string, draft: QuestionDraft): Promise<QuestionDetail> {
    await this.require(id);
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, id);

    const [, row] = await this.prisma.$transaction([
      this.prisma.questionOption.deleteMany({ where: { questionId: id } }),
      this.prisma.question.update({
        where: { id },
        data: {
          ...this.columnsOf(draft, built),
          options: { create: built.options },
        },
        include: QUESTION_INCLUDE,
      }),
    ]);

    return toDetail(row);
  }

  async setActive(id: string, body: SetQuestionActiveBody): Promise<QuestionDetail> {
    await this.require(id);
    return toDetail(
      await this.prisma.question.update({
        where: { id },
        data: { isActive: body.isActive },
        include: QUESTION_INCLUDE,
      }),
    );
  }

  async setStatus(id: string, body: SetQuestionStatusBody): Promise<QuestionDetail> {
    await this.require(id);
    return toDetail(
      await this.prisma.question.update({
        where: { id },
        data: { status: body.status },
        include: QUESTION_INCLUDE,
      }),
    );
  }

  /** The columns a draft decides, shared by create and update. */
  private columnsOf(draft: QuestionDraft, built: ReturnType<typeof buildContent>) {
    return {
      type: draft.type,
      subjectId: draft.subjectId,
      topicId: draft.topicId ?? null,
      subTopicId: draft.subTopicId ?? null,
      difficulty: draft.difficulty,
      status: draft.status,
      questionCode: draft.questionCode ?? null,
      content: built.content as Prisma.InputJsonValue,
      answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      tags: draft.tags,
      defaultMarks: draft.defaultMarks ?? null,
      defaultNegativeMarks: draft.defaultNegativeMarks ?? null,
      stemHash: built.stemHash,
    } satisfies Omit<Prisma.QuestionUncheckedCreateInput, 'id'>;
  }

  /** Runs the shared rules and turns what they report into one envelope failure. */
  private async validated(draft: QuestionDraft) {
    const taxonomy = await taxonomyForIds(this.prisma, {
      subjectIds: [draft.subjectId],
      topicIds: draft.topicId ? [draft.topicId] : [],
      subTopicIds: draft.subTopicId ? [draft.subTopicId] : [],
    });

    const issues = validateQuestion(draft, taxonomy);
    if (issues.length > 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, issues[0]!.message, {
        fieldErrors: fieldErrorsOf(issues),
        details: issues,
      });
    }

    return buildContent(draft);
  }

  /**
   * The same question typed twice is the failure the bank exists to prevent: a
   * duplicate splits its own analytics and can be drawn into one paper twice.
   */
  private async assertNotDuplicate(stemHash: string, exceptId: string | null): Promise<void> {
    const existing = await this.prisma.question.findFirst({
      where: { stemHash, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, content: true },
    });
    if (!existing) return;

    throw new AppException(ErrorCodes.CONFLICT, 'That question is already in the bank', {
      fieldErrors: { 'stem.en': ['That question is already in the bank'] },
      details: { duplicateOf: existing.id },
    });
  }

  private async require(id: string) {
    const row = await this.prisma.question.findUnique({ where: { id }, include: QUESTION_INCLUDE });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    return row;
  }

  /**
   * Search runs as its own query because the stem is JSON: a question is nodes
   * per language, so no column holds the text a `contains` filter would read.
   */
  private async searchIds(term: string): Promise<string[]> {
    const like = `%${term}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Question"
      WHERE "content"::text ILIKE ${like} OR "questionCode" ILIKE ${like}
    `;
    return rows.map((row) => row.id);
  }
}

/** One entry per field, so react-hook-form can put every problem on its own input. */
export function fieldErrorsOf(issues: ValidationIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.field ?? FORM_LEVEL_FIELD;
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

function toSummary(row: QuestionRow): QuestionSummary {
  const content = row.content as LocalizedContent;

  return {
    id: row.id,
    questionCode: row.questionCode,
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    isActive: row.isActive,
    subject: row.subject,
    topic: row.topic,
    subTopic: row.subTopic,
    stemPreview: stemPreviewOf(content),
    languages: languagesInContent(content),
    tags: row.tags,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: QuestionRow): QuestionDetail {
  const content = row.content as LocalizedContent;

  return {
    ...toSummary(row),
    content,
    options: row.options.map((option) => ({
      id: option.id,
      position: option.position,
      isCorrect: option.isCorrect,
      text: option.text as LocalizedRich,
    })),
    answerKey: (row.answerKey as QuestionDetail['answerKey']) ?? null,
    defaultMarks: row.defaultMarks === null ? null : Number(row.defaultMarks),
    defaultNegativeMarks:
      row.defaultNegativeMarks === null ? null : Number(row.defaultNegativeMarks),
    source: (row.source as QuestionSource | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Which languages the stored row really carries — the same rule `buildContent` applied. */
function languagesInContent(content: LocalizedContent): QuestionLanguage[] {
  const stems: Record<string, string> = {};
  for (const [language, field] of Object.entries(content)) {
    stems[language] = plainTextOf(field?.stem);
  }
  return languagesIn(stems);
}
