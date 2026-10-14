import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  QUESTION_STATUS,
  QUESTION_STATUSES,
  type Paginated,
  type QuestionAvailability,
  type QuestionAvailabilityQuery,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionExportQuery,
  type QuestionStatus,
  type QuestionListQuery,
  type QuestionSummary,
  type QuestionVersionSummary,
  type ValidationIssue,
} from '@iace/contracts';
import { EDIT_SUBJECTS, editedElsewhere } from '../common/edit-lock';
import { assertExportable } from '../common/exporting';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  applyImageUrls,
  checkQuestionImage,
  IMMUTABLE_CACHE_CONTROL,
  imageKeysIn,
  questionImageKey,
  type UploadedImage,
} from './question-images';
import { mapQuestionHtml, rewriteQuestionHtml } from './question-content';
import { AuditContext } from '../audit';
import {
  SECTION_WORK_IN_PROGRESS,
  drawableFor,
  buildContent,
  validateQuestion,
  type BuiltQuestion,
} from './question-core';
import { questionOrderBy, questionWhere } from './question-query';
import { writeQuestionExport, type AuthoringCount, type ExportedQuestion } from './question-export';
import { taxonomyForIds } from './taxonomy-context';
import { assertJobOpen, uncheckReworded } from '../assignments';
import { optionsIn } from '../common/prisma-json';
import { questionDiff } from './question-audit';
import { optionsWithIds, versionDataOf, versionFor } from './question-versions';
import {
  FIRST_VERSION,
  QUESTION_EXPORT_SELECT,
  QUESTION_INCLUDE,
  toDetail,
  toExported,
  toSummary,
  type QuestionRow,
} from './question-rows';

/** Which assignment a freshly created question was written for — ownership is the caller's job. */
export interface WriteOptions {
  assignmentId?: string | null;
}

/** Owns `Question` and `QuestionVersion` (docs/03 §5) — the only module that writes them. */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly storage: StorageService,
  ) {}

  /** One pass for the whole question: a stem and its options share images. */
  private served(detail: QuestionDetail): QuestionDetail {
    const keys = new Set(mapQuestionHtml(detail, (html) => html).flatMap(imageKeysIn));
    const urls = new Map([...keys].map((key) => [key, this.storage.publicUrl(key)]));

    return rewriteQuestionHtml(detail, (html) => applyImageUrls(html, urls));
  }

  /** Hands back the KEY that content quotes, plus the url that will serve it from now on. */
  async saveImage(file: UploadedImage | undefined) {
    const { buffer, contentType } = checkQuestionImage(file);

    const key = questionImageKey(contentType);
    await this.storage.upload(key, buffer, contentType, IMMUTABLE_CACHE_CONTROL);

    return { key, url: this.storage.publicUrl(key) };
  }

  /** `scope` is a narrowing the caller owns — authoring passes the author, and cannot be widened out of it. */
  async list(
    query: QuestionListQuery,
    scope?: Prisma.QuestionWhereInput,
  ): Promise<Paginated<QuestionSummary>> {
    const filtered = questionWhere(query);
    const where = scope ? { AND: [filtered, scope] } : filtered;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: QUESTION_INCLUDE,
        orderBy: questionOrderBy(query.sort),
        ...pageArgs(query),
      }),
      this.prisma.question.count({ where }),
    ]);

    return paged(query, rows.map(toSummary), total);
  }

  /** The bank as a workbook: what the export queue's worker writes, never a request. */
  async exportWorkbook(query: QuestionExportQuery): Promise<{ workbook: Buffer; rows: number }> {
    const { questions, authoring } = await this.exportRows(query);
    return { workbook: await writeQuestionExport(questions, authoring), rows: questions.length };
  }

  /** Every row the list would page through, unsigned — a cell carries the image KEY the stem hash folds. */
  async exportRows(
    query: QuestionExportQuery,
  ): Promise<{ questions: ExportedQuestion[]; authoring: AuthoringCount[] }> {
    const where = questionWhere({ ...query, page: 1, pageSize: 1 });
    assertExportable(await this.prisma.question.count({ where }));

    const [rows, groups] = await Promise.all([
      this.prisma.question.findMany({
        where,
        select: QUESTION_EXPORT_SELECT,
        orderBy: questionOrderBy(query.sort),
      }),
      this.prisma.question.groupBy({ by: ['createdById', 'status'], where, _count: true }),
    ]);

    const names = await this.authorNames(groups);
    const byAuthor = new Map<string | null, AuthoringCount>();
    for (const group of groups) {
      const author = byAuthor.get(group.createdById) ?? {
        author: (group.createdById && names.get(group.createdById)) || 'No author',
        byStatus: Object.fromEntries(QUESTION_STATUSES.map((status) => [status, 0])) as Record<
          QuestionStatus,
          number
        >,
      };
      author.byStatus[group.status] = group._count;
      byAuthor.set(group.createdById, author);
    }

    return { questions: rows.map(toExported), authoring: [...byAuthor.values()] };
  }

  /** Counted in the database, because a page of a hundred is not what a section can draw from. */
  async availability(query: QuestionAvailabilityQuery): Promise<QuestionAvailability> {
    const where: Prisma.QuestionWhereInput = {
      ...drawableFor(query.forTestId, query.forKind),
      ...(query.subjectId ? { subjectId: { in: query.subjectId } } : {}),
      ...(query.topicId ? { topicId: { in: query.topicId } } : {}),
      // One question sits on a paper once, so what the test already holds is out of a fill's reach.
      ...(query.forTestId ? { paperQuestions: { none: { testId: query.forTestId } } } : {}),
    };

    const rows = await this.prisma.question.groupBy({ by: ['difficulty'], where, _count: true });
    const byDifficulty = Object.fromEntries(rows.map((row) => [row.difficulty, row._count]));
    const total = rows.reduce((sum, row) => sum + row._count, 0);
    return { total, byDifficulty };
  }

  async detail(id: string): Promise<QuestionDetail> {
    return this.served(toDetail(await this.require(id)));
  }

  /** Asked by the bank's own writes: a section's work is changed on its page until its test is finished. */
  async assertNotSectionWork(id: string): Promise<void> {
    const held = await this.prisma.question.findFirst({
      where: { id, ...SECTION_WORK_IN_PROGRESS },
      select: { assignment: QUESTION_INCLUDE.assignment },
    });
    if (!held?.assignment) return;

    const { test, baseConfigSection } = held.assignment;
    throw new AppException(
      ErrorCodes.CONFLICT,
      `This question is still being written for ${baseConfigSection.name} of ${test.title ?? 'Untitled test'}, so it is changed on that section's page.`,
    );
  }

  /** The chain, newest first, and which papers pin each link — what says who sat which wording. */
  async versions(id: string): Promise<QuestionVersionSummary[]> {
    await this.require(id);

    const rows = await this.prisma.questionVersion.findMany({
      where: { questionId: id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        createdAt: true,
        createdById: true,
        paperQuestions: { select: { test: { select: { title: true } } } },
      },
    });

    const names = await this.authorNames(rows);

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      authorName: (row.createdById && names.get(row.createdById)) || null,
      pinnedBy: row.paperQuestions.map((pinned) => pinned.test.title ?? 'Untitled test'),
    }));
  }

  /** `QuestionVersion.createdById` carries no FK, so the hands behind a chain resolve in one pass. */
  private async authorNames(
    rows: readonly { createdById: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((row) => (row.createdById ? [row.createdById] : [])))];
    if (ids.length === 0) return new Map();

    const admins = await this.prisma.admin.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
    return new Map(admins.map((admin) => [admin.id, admin.fullName ?? admin.email]));
  }

  async create(
    draft: QuestionDraft,
    createdById: string,
    options: WriteOptions = {},
  ): Promise<QuestionDetail> {
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, null);

    const row = await this.prisma.$transaction(async (tx) => {
      if (options.assignmentId) await assertJobOpen(tx, options.assignmentId);
      const question = await tx.question.create({
        data: {
          ...this.columnsOf(draft, built),
          createdById,
          assignmentId: options.assignmentId ?? null,
        },
      });
      const version = await tx.questionVersion.create({
        data: versionDataOf(
          question.id,
          FIRST_VERSION,
          built,
          optionsWithIds(built, []),
          createdById,
        ),
      });
      return tx.question.update({
        where: { id: question.id },
        data: { currentVersionId: version.id },
        include: QUESTION_INCLUDE,
      });
    }, TX_LIMITS.SHORT);

    // Named here because a caller may wrap the answer, and the audit reads only a top-level id.
    this.auditContext.setEntityId(row.id);
    return this.served(toDetail(row));
  }

  /** Rewritten in place while nothing reachable pins the version; anything else gains one. */
  async update(id: string, draft: QuestionDraft, createdById: string): Promise<QuestionDetail> {
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, id);

    const { before, after } = await this.prisma.$transaction(
      (tx) => this.writeEdit(tx, id, draft, built, createdById),
      TX_LIMITS.SHORT,
    );

    this.auditContext.setChanged(questionDiff(before, after));

    return this.served(toDetail(after));
  }

  /** Read ONLY inside the transaction, so the row this decides on is the row it goes on to write. */
  private async writeEdit(
    tx: Prisma.TransactionClient,
    id: string,
    draft: QuestionDraft,
    built: BuiltQuestion,
    createdById: string,
  ): Promise<{ before: QuestionRow; after: QuestionRow }> {
    const question = await tx.question.findUnique({ where: { id }, include: QUESTION_INCLUDE });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    assertScreenIsCurrent(question, draft);
    await this.assertIdentitySettled(tx, question, draft);

    // One order everywhere, Test before Question; drafts holding only its tick too, so a put-back cannot race the uncheck.
    await tx.$queryRaw`
      SELECT 1 FROM "Test" WHERE "id" IN (
        SELECT "testId" FROM "PaperQuestion" WHERE "questionId" = ${id}::uuid
        UNION
        SELECT r."testId" FROM "QuestionReview" r JOIN "Test" t ON t."id" = r."testId"
        WHERE r."questionId" = ${id}::uuid AND t."finalizedAt" IS NULL
      ) ORDER BY "id" FOR UPDATE`;

    // Pinned to the row as read, so the version and content this rests on cannot be out of date.
    const claimed = await tx.question.updateMany({
      where: { id, updatedAt: question.updatedAt },
      data: this.columnsOf(draft, built),
    });
    if (claimed.count !== 1) throw questionEditedElsewhere();

    // Merged here, so what is compared below is exactly what would be written.
    const options = optionsWithIds(built, optionsIn(question.currentVersion?.options));
    const version = await versionFor(tx, question, built, options, createdById);
    // A reader's tick was on the old words, which no draft paper serves any more.
    if (version.reworded) await uncheckReworded(tx, id);

    const after = await tx.question.update({
      where: { id },
      data: { currentVersionId: version.id },
      include: QUESTION_INCLUDE,
    });
    return { before: question, after };
  }

  private async setStatus(id: string, status: QuestionStatus): Promise<QuestionDetail> {
    const question = await this.require(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Pinned, so a decision made against a status somebody has since changed is refused.
      const claimed = await tx.question.updateMany({
        where: { id, updatedAt: question.updatedAt },
        data: { status },
      });
      if (claimed.count !== 1) throw questionEditedElsewhere();

      return tx.question.findUniqueOrThrow({ where: { id }, include: QUESTION_INCLUDE });
    }, TX_LIMITS.SHORT);

    this.auditContext.setChanged(questionDiff(question, updated));

    return this.served(toDetail(updated));
  }

  /** The soft remove: out of circulation and out of the bank, reversible and losing nothing. */
  archive(id: string): Promise<QuestionDetail> {
    return this.setStatus(id, QUESTION_STATUS.ARCHIVED);
  }

  /** Back into circulation, which is the only place an archived question can go. */
  unarchive(id: string): Promise<QuestionDetail> {
    return this.setStatus(id, QUESTION_STATUS.ACTIVE);
  }

  /** The one hard delete: a question nobody drew, nobody sat and nothing measured, at any status. */
  async remove(id: string): Promise<void> {
    const before = await this.require(id);

    await this.prisma.$transaction(async (tx) => {
      // Conditional: it takes the row's lock and clears the pointer that RESTRICTS the version.
      const claimed = await tx.question.updateMany({
        where: { id, updatedAt: before.updatedAt },
        data: { currentVersionId: null },
      });
      if (claimed.count !== 1) throw questionEditedElsewhere();
      await this.deleteUnused(tx, [id]);
    }, TX_LIMITS.SHORT);

    this.auditContext.setEntityId(id);
    this.auditContext.setChanged({ status: { from: before.status, to: 'DELETED' } });
  }

  /** A typist's Done, inside its own transaction: the discarded go for good, the rest stay in the bank loose. */
  async settleTyped(
    tx: Prisma.TransactionClient,
    discard: readonly string[],
    detach: readonly string[],
  ): Promise<void> {
    if (discard.length > 0) {
      await tx.question.updateMany({
        where: { id: { in: [...discard] } },
        data: { currentVersionId: null },
      });
      await this.deleteUnused(tx, discard);
    }
    if (detach.length > 0) {
      await tx.question.updateMany({
        where: { id: { in: [...detach] } },
        data: { assignmentId: null },
      });
    }
  }

  /** Every pointer to the versions already cleared; refused before a foreign key would be. */
  private async deleteUnused(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<void> {
    if (await this.anyUsed(tx, [...ids])) {
      throw refused(
        'A paper or an attempt already uses this question, so it cannot be deleted.',
        'Something already uses this question',
      );
    }
    await tx.questionVersion.deleteMany({ where: { questionId: { in: [...ids] } } });
    await tx.question.deleteMany({ where: { id: { in: [...ids] } } });
  }

  /** Being depended on settles what a question IS, not being published — a drawn row carries none of it. */
  private async assertIdentitySettled(
    tx: Prisma.TransactionClient,
    before: QuestionRow,
    draft: QuestionDraft,
  ): Promise<void> {
    // A typed answer and a set of options are different questions, so a retype replaces rather than edits.
    const retyped = draft.type !== before.type;
    // A topic it never had is filled in, not moved: nothing drew it by a topic that was not there.
    const retopiced = before.topicId !== null && (draft.topicId ?? null) !== before.topicId;
    const moved = draft.subjectId !== before.subjectId || retopiced;
    if (!retyped && !moved) return;
    if (!(await this.isUsed(tx, before.id))) return;

    throw refused(
      'A paper or an attempt already uses this question, so it keeps its subject, topic and type.',
      'Something already uses this question',
      retyped ? 'type' : 'subjectId',
    );
  }

  /** Every table that keys on the question, so the rule refuses before a foreign key does. */
  private async anyUsed(tx: Prisma.TransactionClient, ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;

    const questionId = { in: ids };
    const [papers, stats] = await Promise.all([
      tx.paperQuestion.count({ where: { questionId } }),
      tx.testQuestionStat.count({ where: { questionId } }),
    ]);
    return papers + stats > 0;
  }

  private isUsed(tx: Prisma.TransactionClient, questionId: string): Promise<boolean> {
    return this.anyUsed(tx, [questionId]);
  }

  /** The columns a draft decides — identity and taxonomy only; content lives in the version. */
  private columnsOf(draft: QuestionDraft, built: ReturnType<typeof buildContent>) {
    return {
      type: draft.type,
      subjectId: draft.subjectId,
      topicId: draft.topicId ?? null,
      difficulty: draft.difficulty,
      // Absent keeps the stored code, null clears it: no editor shows the code, so none may erase it.
      questionCode: draft.questionCode,
      tags: draft.tags,
      stemHash: built.stemHash,
      stemHashVersion: built.stemHashVersion,
    } satisfies Omit<Prisma.QuestionUncheckedCreateInput, 'id'>;
  }

  /** Runs the shared rules and turns what they report into one envelope failure. */
  private async validated(draft: QuestionDraft) {
    const taxonomy = await taxonomyForIds(this.prisma, {
      subjectIds: [draft.subjectId],
      topicIds: draft.topicId ? [draft.topicId] : [],
    });

    const issues = validateQuestion(draft, taxonomy);
    const [first] = issues;
    if (first !== undefined) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, first.message, {
        fieldErrors: fieldErrorsOf(issues),
        details: issues,
      });
    }

    return buildContent(draft);
  }

  /** The same question typed twice is the failure the bank exists to prevent: a duplicate splits its own analytics and can be drawn into one paper twice. */
  /** The question this stem repeats, if the bank already holds one. */
  async duplicateOf(
    stemHash: string,
    exceptId: string | null,
  ): Promise<{ id: string; stemPreview: string } | null> {
    const existing = await this.prisma.question.findFirst({
      where: { stemHash, ...(exceptId ? { id: { not: exceptId } } : {}) },
      include: QUESTION_INCLUDE,
    });
    return existing ? { id: existing.id, stemPreview: toSummary(existing).stemPreview } : null;
  }

  private async assertNotDuplicate(stemHash: string, exceptId: string | null): Promise<void> {
    const existing = await this.prisma.question.findFirst({
      where: { stemHash, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, status: true },
    });
    if (!existing) return;

    // The bank does not list the archived, so an admin sent to look would find nothing there.
    const where =
      existing.status === QUESTION_STATUS.ARCHIVED
        ? 'That question is already in the bank, archived. Bring that one back rather than retyping it.'
        : 'That question is already in the bank';

    throw new AppException(ErrorCodes.CONFLICT, where, {
      fieldErrors: { 'stem.en': [where] },
      details: { duplicateOf: existing.id },
    });
  }

  private async require(id: string) {
    const row = await this.prisma.question.findUnique({ where: { id }, include: QUESTION_INCLUDE });
    if (!row) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    return row;
  }
}

/** One entry per field, so react-hook-form can put every problem on its own input. */
function fieldErrorsOf(issues: ValidationIssue[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.field ?? FORM_LEVEL_FIELD;
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

/** A form open since before somebody else's save would write its stale fields over theirs. */
function assertScreenIsCurrent(before: QuestionRow, draft: QuestionDraft): void {
  const expected = draft.expectedUpdatedAt;
  if (expected === undefined || expected === before.updatedAt.toISOString()) return;
  throw questionEditedElsewhere();
}

/** The shared stale-save refusal, on `status` — the field a question's decisions already ride. */
const questionEditedElsewhere = () => editedElsewhere(EDIT_SUBJECTS.QUESTION, 'status');

const refused = (message: string, note: string, field = 'status') =>
  new AppException(ErrorCodes.CONFLICT, message, { fieldErrors: { [field]: [note] } });
