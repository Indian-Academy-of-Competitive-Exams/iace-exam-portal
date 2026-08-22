import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  fieldDiff,
  plainTextOf,
  type LocalizedContent,
  type Paginated,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionLanguage,
  type QuestionListQuery,
  type QuestionOption,
  type QuestionSummary,
  type SetQuestionStatusBody,
  type ValidationIssue,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { buildContent, languagesIn, stemPreviewOf, validateQuestion } from './question-core';
import { questionOrderBy, questionWhere } from './question-query';
import { taxonomyForIds } from './taxonomy-context';

const QUESTION_INCLUDE = {
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  currentVersion: true,
} as const satisfies Prisma.QuestionInclude;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/**
 * Excludes localized content — spelling changes as often as meaning, and an edit to it inserts a
 * version rather than changing a column. `correctOptionPositions` is keyed to `position`, which is
 * what survives across versions.
 */
export const AUDITED_QUESTION_FIELDS = [
  'type',
  'subjectId',
  'topicId',
  'difficulty',
  'questionCode',
  'status',
  'version',
  'correctOptionPositions',
  'answerKey',
] as const;

/** Owns `Question` and `QuestionVersion` (docs/03 §5) — the only module that writes them. */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
  ) {}

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

    const row = await this.prisma.$transaction(async (tx) => {
      const question = await tx.question.create({
        data: { ...this.columnsOf(draft, built), createdById },
      });
      const version = await tx.questionVersion.create({
        data: versionDataOf(question.id, FIRST_VERSION, built, [], createdById),
      });
      return tx.question.update({
        where: { id: question.id },
        data: { currentVersionId: version.id },
        include: QUESTION_INCLUDE,
      });
    });

    return toDetail(row);
  }

  /**
   * An edit INSERTS a version and repoints the question at it. Nothing that already pinned the
   * old one — a paper, an attempt — moves, which is the entire reason versions exist. Option ids
   * carry over by position, so a re-save does not churn the ids a screen is holding.
   */
  async update(id: string, draft: QuestionDraft, createdById: string): Promise<QuestionDetail> {
    const question = await this.require(id);
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, id);

    const current = currentOptionsOf(question);
    const nextNumber = (question.currentVersion?.version ?? 0) + 1;

    const row = await this.prisma.$transaction(async (tx) => {
      const version = await tx.questionVersion.create({
        data: versionDataOf(id, nextNumber, built, current, createdById),
      });
      return tx.question.update({
        where: { id },
        data: { ...this.columnsOf(draft, built), currentVersionId: version.id },
        include: QUESTION_INCLUDE,
      });
    });

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(question), auditFieldsOf(row), AUDITED_QUESTION_FIELDS),
    );

    return toDetail(row);
  }

  async setStatus(id: string, body: SetQuestionStatusBody): Promise<QuestionDetail> {
    const question = await this.require(id);
    const updated = await this.prisma.question.update({
      where: { id },
      data: { status: body.status },
      include: QUESTION_INCLUDE,
    });

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(question), auditFieldsOf(updated), AUDITED_QUESTION_FIELDS),
    );

    return toDetail(updated);
  }

  /** The columns a draft decides — identity and taxonomy only; content lives in the version. */
  private columnsOf(draft: QuestionDraft, built: ReturnType<typeof buildContent>) {
    return {
      type: draft.type,
      subjectId: draft.subjectId,
      topicId: draft.topicId ?? null,
      difficulty: draft.difficulty,
      // Omitted means "leave it": DRAFT on create, and an archived question stays archived.
      ...(draft.status === undefined ? {} : { status: draft.status }),
      questionCode: draft.questionCode ?? null,
      tags: draft.tags,
      stemHash: built.stemHash,
    } satisfies Omit<Prisma.QuestionUncheckedCreateInput, 'id'>;
  }

  /** Runs the shared rules and turns what they report into one envelope failure. */
  private async validated(draft: QuestionDraft) {
    const taxonomy = await taxonomyForIds(this.prisma, {
      subjectIds: [draft.subjectId],
      topicIds: draft.topicId ? [draft.topicId] : [],
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
      select: { id: true },
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
   * Search runs as its own query because the stem is JSON on the version: a question is nodes
   * per language, so no column holds the text a `contains` filter would read.
   */
  private async searchIds(term: string): Promise<string[]> {
    const like = `%${term}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT q."id" FROM "Question" q
      LEFT JOIN "QuestionVersion" v ON v."id" = q."currentVersionId" AND v."questionId" = q."id"
      WHERE v."content"::text ILIKE ${like} OR q."questionCode" ILIKE ${like}
    `;
    return rows.map((row) => row.id);
  }
}

/** Every question starts at 1; `update` counts up from the current version. */
const FIRST_VERSION = 1;

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

/**
 * A version row from a built draft. `previous` supplies an option id for each position that
 * already had one — an attempt stores the id it was shown, so a stable id is worth keeping.
 */
function versionDataOf(
  questionId: string,
  version: number,
  built: ReturnType<typeof buildContent>,
  previous: QuestionOption[],
  createdById: string,
): Prisma.QuestionVersionUncheckedCreateInput {
  const options = built.options.map((option) => ({
    id: previous.find((old) => old.position === option.position)?.id ?? randomUUID(),
    position: option.position,
    isCorrect: option.isCorrect,
    text: option.text,
  }));

  return {
    questionId,
    version,
    createdById,
    content: built.content as Prisma.InputJsonValue,
    options: options as unknown as Prisma.InputJsonValue,
    answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
}

/** The current version's options, parsed out of JSON. Absent or malformed reads as none. */
function currentOptionsOf(row: QuestionRow): QuestionOption[] {
  const options = row.currentVersion?.options;
  return Array.isArray(options) ? (options as unknown as QuestionOption[]) : [];
}

/** `options`, kept only as the scoring key: the sorted positions of the ones marked correct. */
function auditFieldsOf(row: QuestionRow): {
  type: QuestionRow['type'];
  subjectId: string;
  topicId: string | null;
  difficulty: QuestionRow['difficulty'];
  questionCode: string | null;
  status: QuestionRow['status'];
  version: number | null;
  correctOptionPositions: number[];
  answerKey: unknown;
} {
  return {
    type: row.type,
    subjectId: row.subjectId,
    topicId: row.topicId,
    difficulty: row.difficulty,
    questionCode: row.questionCode,
    status: row.status,
    version: row.currentVersion?.version ?? null,
    answerKey: row.currentVersion?.answerKey ?? null,
    correctOptionPositions: currentOptionsOf(row)
      .filter((option) => option.isCorrect)
      .map((option) => option.position)
      .sort((a, b) => a - b),
  };
}

function toSummary(row: QuestionRow): QuestionSummary {
  const content = contentOf(row);

  return {
    id: row.id,
    questionCode: row.questionCode,
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    subject: row.subject,
    topic: row.topic,
    stemPreview: stemPreviewOf(content),
    languages: languagesInContent(content),
    tags: row.tags,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: QuestionRow): QuestionDetail {
  return {
    ...toSummary(row),
    version: row.currentVersion?.version ?? FIRST_VERSION,
    content: contentOf(row),
    options: currentOptionsOf(row),
    answerKey: (row.currentVersion?.answerKey as QuestionDetail['answerKey']) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A question with no current version has nothing to show — an empty content map, not a crash. */
function contentOf(row: QuestionRow): LocalizedContent {
  return (row.currentVersion?.content as LocalizedContent | undefined) ?? {};
}

/** Which languages the stored row really carries — the same rule `buildContent` applied. */
function languagesInContent(content: LocalizedContent): QuestionLanguage[] {
  const stems: Record<string, string> = {};
  for (const [language, field] of Object.entries(content)) {
    stems[language] = plainTextOf(field?.stem);
  }
  return languagesIn(stems);
}
