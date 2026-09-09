import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  QUESTION_FLAG_STATUS,
  QUESTION_STATUS,
  fieldDiff,
  plainTextOf,
  type LocalizedContent,
  type Paginated,
  type QuestionAvailability,
  type QuestionAvailabilityQuery,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionLanguage,
  type QuestionListQuery,
  type QuestionOption,
  type QuestionStatus,
  type QuestionSummary,
  type BulkQuestionStatusBody,
  type BulkQuestionStatusResult,
  type SetQuestionStatusBody,
  type ValidationIssue,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  applyImageUrls,
  checkQuestionImage,
  imageKeysIn,
  questionImageKey,
  type UploadedImage,
} from './question-images';
import { escapeForContent, mapQuestionHtml, rewriteQuestionHtml } from './question-content';
import { AuditContext } from '../audit';
import {
  buildContent,
  languagesIn,
  stemPreviewOf,
  validateQuestion,
  type BuiltQuestion,
} from './question-core';
import { questionOrderBy, questionWhere } from './question-query';
import { taxonomyForIds } from './taxonomy-context';

const QUESTION_INCLUDE = {
  subject: { select: { id: true, name: true } },
  topic: { select: { id: true, name: true } },
  // The relation, not a second lookup: a page of drafts names its authors in one round trip.
  createdBy: { select: { id: true, fullName: true, email: true } },
  currentVersion: true,
  // Counted in the row's own query, so a page of questions costs one round trip, not one each.
  _count: {
    select: {
      paperQuestions: true,
      attemptItems: true,
      questionStats: true,
      flags: { where: { status: QUESTION_FLAG_STATUS.OPEN } },
    },
  },
} as const satisfies Prisma.QuestionInclude;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/** What an edit can change: the columns, plus a fingerprint of what the question actually says. */
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
  'content',
] as const;

/** Long enough to survive an authoring session; content stores the key, so nothing outlives it. */
const QUESTION_IMAGE_URL_TTL_SEC = 3600;

/** What a caller may relax. The bank refuses a duplicate; the authoring editor reports it. */
export interface WriteOptions {
  allowDuplicate?: boolean;
}

/** Owns `Question` and `QuestionVersion` (docs/03 §5) — the only module that writes them. */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly storage: StorageService,
  ) {}

  /** Signs every image the content quotes, in one pass — a stem and its options share images. */
  private async signed(detail: QuestionDetail): Promise<QuestionDetail> {
    const [only] = await this.signedAll([detail]);
    return only ?? detail;
  }

  /** One signing pass for a whole page: a document of twenty questions is not twenty passes. */
  private async signedAll(details: QuestionDetail[]): Promise<QuestionDetail[]> {
    const keys = new Set(
      details.flatMap((detail) => mapQuestionHtml(detail, (html) => html).flatMap(imageKeysIn)),
    );
    if (keys.size === 0) return details;

    const urls = new Map(
      await Promise.all(
        [...keys].map(
          async (key) =>
            [key, await this.storage.createDownloadUrl(key, QUESTION_IMAGE_URL_TTL_SEC)] as const,
        ),
      ),
    );

    return details.map((detail) =>
      rewriteQuestionHtml(detail, (html) => applyImageUrls(html, urls)),
    );
  }

  /** Hands back the KEY that content quotes, plus a url that only shows what was just picked. */
  async saveImage(file: UploadedImage | undefined) {
    const { buffer, contentType } = checkQuestionImage(file);

    const key = questionImageKey(contentType);
    await this.storage.upload(key, buffer, contentType);

    return { key, url: await this.storage.createDownloadUrl(key, QUESTION_IMAGE_URL_TTL_SEC) };
  }

  /** `scope` is a narrowing the caller owns — authoring passes the author, and cannot be widened out of it. */
  async list(
    query: QuestionListQuery,
    scope?: Prisma.QuestionWhereInput,
  ): Promise<Paginated<QuestionSummary>> {
    const [rows, total] = await this.pageOf(query, scope);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  /** The same page in FULL, images signed together — a document to read, not a table to scan. */
  async page(query: QuestionListQuery): Promise<Paginated<QuestionDetail>> {
    const [rows, total] = await this.pageOf(query);
    const items = await this.signedAll(rows.map(toDetail));
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  private async pageOf(
    query: QuestionListQuery,
    scope?: Prisma.QuestionWhereInput,
  ): Promise<[QuestionRow[], number]> {
    const matchedIds = query.q ? await this.searchIds(query.q) : null;
    const filtered = questionWhere(query, matchedIds);
    const where = scope ? { AND: [filtered, scope] } : filtered;

    return this.prisma.$transaction([
      this.prisma.question.findMany({
        where,
        include: QUESTION_INCLUDE,
        orderBy: questionOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.question.count({ where }),
    ]);
  }

  /** Counted in the database, because a page of a hundred is not what a section can draw from. */
  async availability(query: QuestionAvailabilityQuery): Promise<QuestionAvailability> {
    const where: Prisma.QuestionWhereInput = {
      status: QUESTION_STATUS.ACTIVE,
      currentVersionId: { not: null },
      ...(query.subjectId ? { subjectId: { in: query.subjectId } } : {}),
      ...(query.topicId ? { topicId: { in: query.topicId } } : {}),
    };

    const rows = await this.prisma.question.groupBy({ by: ['difficulty'], where, _count: true });
    const byDifficulty = Object.fromEntries(rows.map((row) => [row.difficulty, row._count]));
    const total = rows.reduce((sum, row) => sum + row._count, 0);
    return { total, byDifficulty };
  }

  async detail(id: string): Promise<QuestionDetail> {
    return this.signed(toDetail(await this.require(id)));
  }

  async create(
    draft: QuestionDraft,
    createdById: string,
    options: WriteOptions = {},
  ): Promise<QuestionDetail> {
    assertIntakeStatus(draft.status);
    const built = await this.validated(draft);
    if (!options.allowDuplicate) await this.assertNotDuplicate(built.stemHash, null);

    const row = await this.prisma.$transaction(async (tx) => {
      const question = await tx.question.create({
        data: { ...this.columnsOf(draft, built), createdById },
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
    });

    return this.signed(toDetail(row));
  }

  /** A draft still being written is revised in place; anything published gains a version instead. */
  async update(
    id: string,
    draft: QuestionDraft,
    createdById: string,
    options: WriteOptions = {},
  ): Promise<QuestionDetail> {
    const question = await this.require(id);
    assertScreenIsCurrent(question, draft);
    assertTaxonomySettled(question, draft);
    const built = await this.validated(draft);
    if (!options.allowDuplicate) await this.assertNotDuplicate(built.stemHash, id);

    const row = await this.prisma.$transaction((tx) =>
      this.writeEdit(tx, id, draft, built, createdById),
    );

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(question), auditFieldsOf(row), AUDITED_QUESTION_FIELDS),
    );

    return this.signed(toDetail(row));
  }

  /** Re-read inside the transaction, so the row this decides on is the row it goes on to write. */
  private async writeEdit(
    tx: Prisma.TransactionClient,
    id: string,
    draft: QuestionDraft,
    built: BuiltQuestion,
    createdById: string,
  ): Promise<QuestionRow> {
    const question = await tx.question.findUnique({ where: { id }, include: QUESTION_INCLUDE });
    if (!question) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
    assertTaxonomySettled(question, draft);
    await this.assertStatusReachable(tx, id, question.status, draft.status);

    // Pinned to the row as read, so the version and content this rests on cannot be out of date.
    const claimed = await tx.question.updateMany({
      where: { id, updatedAt: question.updatedAt },
      data: this.columnsOf(draft, built),
    });
    if (claimed.count !== 1) throw editedElsewhere();

    // Merged here, so what is compared below is exactly what would be written.
    const options = optionsWithIds(built, currentOptionsOf(question));

    return tx.question.update({
      where: { id },
      data: { currentVersionId: await this.versionFor(tx, question, built, options, createdById) },
      include: QUESTION_INCLUDE,
    });
  }

  /** A save that says the same thing writes no version, and puts no new hand on a draft. */
  private async versionFor(
    tx: Prisma.TransactionClient,
    question: QuestionRow,
    built: BuiltQuestion,
    options: QuestionOption[],
    createdById: string,
  ): Promise<string | null> {
    const says = fingerprint(built.content, options, built.answerKey ?? null);
    if (question.currentVersionId && says === contentHashOf(question)) {
      return question.currentVersionId;
    }

    const revisable = await this.revisableVersionId(tx, question);
    return revisable
      ? this.revise(tx, revisable, built, options, createdById)
      : this.insertVersion(tx, question, built, options, createdById);
  }

  /** The current version when it may be rewritten rather than replaced, or null when it may not. */
  private async revisableVersionId(
    tx: Prisma.TransactionClient,
    question: QuestionRow,
  ): Promise<string | null> {
    const questionVersionId = question.currentVersionId;
    if (!questionVersionId || question.status !== QUESTION_STATUS.DRAFT) return null;

    // The guard no status can give: a version a paper or an attempt holds must never move under it.
    const [papers, attempts] = await Promise.all([
      tx.paperQuestion.count({ where: { questionId: question.id, questionVersionId } }),
      tx.attemptQuestion.count({ where: { questionId: question.id, questionVersionId } }),
    ]);

    return papers + attempts > 0 ? null : questionVersionId;
  }

  /** Version 1 of a question nobody has drawn stays version 1, however often it is saved. */
  private async revise(
    tx: Prisma.TransactionClient,
    versionId: string,
    built: BuiltQuestion,
    options: QuestionOption[],
    createdById: string,
  ): Promise<string> {
    await tx.questionVersion.update({
      where: { id: versionId },
      data: {
        content: built.content as Prisma.InputJsonValue,
        options: options as unknown as Prisma.InputJsonValue,
        answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        // The words and the moment are now this admin's, not those of whoever opened the draft.
        createdById,
        createdAt: new Date(),
      },
    });
    return versionId;
  }

  /** Nothing that pinned the old version moves, which is the entire reason versions exist. */
  private async insertVersion(
    tx: Prisma.TransactionClient,
    question: QuestionRow,
    built: BuiltQuestion,
    options: QuestionOption[],
    createdById: string,
  ): Promise<string> {
    const version = await tx.questionVersion.create({
      data: versionDataOf(
        question.id,
        (question.currentVersion?.version ?? 0) + 1,
        built,
        options,
        createdById,
      ),
    });
    return version.id;
  }

  async setStatus(id: string, body: SetQuestionStatusBody): Promise<QuestionDetail> {
    const question = await this.require(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertStatusReachable(tx, id, question.status, body.status);

      // Pinned, so a decision made against a status somebody has since changed is refused.
      const claimed = await tx.question.updateMany({
        where: { id, updatedAt: question.updatedAt },
        data: { status: body.status },
      });
      if (claimed.count !== 1) throw editedElsewhere();

      return tx.question.findUniqueOrThrow({ where: { id }, include: QUESTION_INCLUDE });
    });

    this.auditContext.setChanged(
      fieldDiff(auditFieldsOf(question), auditFieldsOf(updated), AUDITED_QUESTION_FIELDS),
    );

    return this.signed(toDetail(updated));
  }

  /** The soft remove: out of circulation and out of the bank, reversible and losing nothing. */
  archive(id: string): Promise<QuestionDetail> {
    return this.setStatus(id, { status: QUESTION_STATUS.ARCHIVED });
  }

  /** Back into circulation, which is the only place an archived question can go. */
  unarchive(id: string): Promise<QuestionDetail> {
    return this.setStatus(id, { status: QUESTION_STATUS.ACTIVE });
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
      if (claimed.count !== 1) throw editedElsewhere();

      if (await this.isUsed(tx, id)) throw stillInUse('deleted');

      await tx.questionVersion.deleteMany({ where: { questionId: id } });
      await tx.question.delete({ where: { id } });
    });

    this.auditContext.setChanged({ status: { from: before.status, to: 'DELETED' } });
  }

  /** Where a question may go: back to a working copy only while nothing has come to depend on it. */
  private async assertStatusReachable(
    tx: Prisma.TransactionClient,
    id: string,
    from: QuestionStatus,
    to: QuestionStatus | undefined,
  ): Promise<void> {
    assertWasInCirculation(from, to);
    if (to === QUESTION_STATUS.ACTIVE && from !== QUESTION_STATUS.ACTIVE) {
      await this.assertFlagsSettled(tx, id);
    }
    if (to !== QUESTION_STATUS.DRAFT || from === QUESTION_STATUS.DRAFT) return;
    if (await this.isUsed(tx, id)) throw stillInUse('returned to draft');
  }

  /** A reviewer's outstanding objection outranks an approval, whichever screen the approval came from. */
  private async assertFlagsSettled(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const open = await tx.questionFlag.count({
      where: { questionId: id, status: QUESTION_FLAG_STATUS.OPEN },
    });
    if (open > 0) throw stillFlagged(open);
  }

  /** Every table that keys on the question, so the rule refuses before a foreign key does. */
  private async anyUsed(tx: Prisma.TransactionClient, ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false;

    const questionId = { in: ids };
    const [papers, attempts, stats] = await Promise.all([
      tx.paperQuestion.count({ where: { questionId } }),
      tx.attemptQuestion.count({ where: { questionId } }),
      tx.testQuestionStat.count({ where: { questionId } }),
    ]);
    return papers + attempts + stats > 0;
  }

  private isUsed(tx: Prisma.TransactionClient, questionId: string): Promise<boolean> {
    return this.anyUsed(tx, [questionId]);
  }

  /** The same gate over a batch, counted by QUESTION: one flagged row refuses the whole decision. */
  private async assertBatchFlagsSettled(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<void> {
    const flagged = await tx.question.count({
      where: {
        id: { in: ids },
        status: { not: QUESTION_STATUS.ACTIVE },
        flags: { some: { status: QUESTION_FLAG_STATUS.OPEN } },
      },
    });
    if (flagged > 0) throw batchStillFlagged(flagged);
  }

  /** One decision over many rows: one statement, so a half-applied batch is not a state. */
  async bulkSetStatus(body: BulkQuestionStatusBody): Promise<BulkQuestionStatusResult> {
    const ids = [...new Set(body.ids)];

    // Checked and applied together, so a row that changes underneath is not half-decided.
    const { count } = await this.prisma.$transaction(async (tx) => {
      await this.assertBatchCanMove(tx, ids, body.status);
      return tx.question.updateMany({ where: { id: { in: ids } }, data: { status: body.status } });
    });

    // The row is the batch, not any one question — the interceptor has no :id to fall back on.
    this.auditContext.setEntityId(`${count} questions`);
    // A batch has many befores, so the trail records the decision rather than inventing one.
    this.auditContext.setChanged({ status: { from: 'many', to: body.status } });

    return { updated: count };
  }

  /** A batch is one decision, so one row that cannot make the move refuses all of it. */
  private async assertBatchCanMove(
    tx: Prisma.TransactionClient,
    ids: string[],
    status: QuestionStatus,
  ): Promise<void> {
    if (status === QUESTION_STATUS.ACTIVE) await this.assertBatchFlagsSettled(tx, ids);
    if (status === QUESTION_STATUS.ARCHIVED) {
      const drafts = await tx.question.findMany({
        where: { id: { in: ids }, status: QUESTION_STATUS.DRAFT },
        select: { id: true },
      });
      if (drafts[0]) assertWasInCirculation(QUESTION_STATUS.DRAFT, status);
    }
    if (status !== QUESTION_STATUS.DRAFT) return;

    const leaving = await tx.question.findMany({
      where: { id: { in: ids }, status: { not: QUESTION_STATUS.DRAFT } },
      select: { id: true },
    });
    if (
      await this.anyUsed(
        tx,
        leaving.map((row) => row.id),
      )
    )
      throw stillInUse('returned to draft');
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
    const [first] = issues;
    if (first !== undefined) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, first.message, {
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

  /**
   * Search runs as its own query because the stem is JSON on the version: a question is nodes
   * per language, so no column holds the text a `contains` filter would read.
   */
  private async searchIds(term: string): Promise<string[]> {
    // Content is stored as html, so "Ram & Shyam" sits in it as "Ram &amp; Shyam".
    const like = `%${escapeForContent(term)}%`;
    // A tag is stored as the admin typed it, so the escaping the html content needs would miss it.
    const tagLike = `%${term}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT q."id" FROM "Question" q
      LEFT JOIN "QuestionVersion" v ON v."id" = q."currentVersionId" AND v."questionId" = q."id"
      WHERE v."content"::text ILIKE ${like}
         OR q."questionCode" ILIKE ${like}
         OR EXISTS (SELECT 1 FROM unnest(q."tags") AS tag WHERE tag ILIKE ${tagLike})
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

/** ARCHIVED is a retirement, so nothing arrives in it — the one status a question cannot start in. */
function assertIntakeStatus(status: QuestionStatus | undefined): void {
  if (status !== QUESTION_STATUS.ARCHIVED) return;
  throw refused('A question cannot be created as archived.', 'Create it as a draft or as active');
}

/** A form open since before somebody else's save would write its stale fields over theirs. */
function assertScreenIsCurrent(before: QuestionRow, draft: QuestionDraft): void {
  const expected = draft.expectedUpdatedAt;
  if (expected === undefined || expected === before.updatedAt.toISOString()) return;
  throw editedElsewhere();
}

/** A draft was never in circulation, so retiring it would only be a way to publish it unreviewed. */
function assertWasInCirculation(from: QuestionStatus, to: QuestionStatus | undefined): void {
  if (to !== QUESTION_STATUS.ARCHIVED || from !== QUESTION_STATUS.DRAFT) return;
  throw refused(
    'A draft was never in circulation. Delete it instead, or publish it first.',
    'This question is still a draft',
  );
}

/** Settling the flag lifts the block; nothing here changes a status on its own. */
const stillFlagged = (open: number) =>
  refused(
    open === 1
      ? 'This question has 1 open proof-reading flag. Resolve or dismiss it before it can go active.'
      : `This question has ${open} open proof-reading flags. Resolve or dismiss them before it can go active.`,
    'Open proof-reading flags',
  );

const batchStillFlagged = (flagged: number) =>
  refused(
    flagged === 1
      ? '1 of these questions has open proof-reading flags. Resolve or dismiss them before it can go active.'
      : `${flagged} of these questions have open proof-reading flags. Resolve or dismiss them before they can go active.`,
    'Open proof-reading flags',
  );

/** Back to a working copy only while it is nobody's question but its author's. */
const stillInUse = (what: string) =>
  refused(
    `A paper or an attempt already uses this question, so it cannot be ${what}.`,
    'Something already uses this question',
  );

/** Taxonomy is what a paper draws on, so it settles when the question leaves the draft. */
function assertTaxonomySettled(before: QuestionRow, draft: QuestionDraft): void {
  if (before.status === QUESTION_STATUS.DRAFT) return;
  if (draft.subjectId === before.subjectId && (draft.topicId ?? null) === before.topicId) return;

  throw refused(
    'A question that has left the draft keeps its subject and topic. Return it to draft to move it.',
    'Settled when the question left the draft',
    'subjectId',
  );
}

/** Someone else moved the row between reading it and writing it; the save is not silently applied. */
const editedElsewhere = () =>
  refused(
    'Somebody else changed this question while you were working on it. Open it again.',
    'This question changed while you were editing it',
  );

const refused = (message: string, note: string, field = 'status') =>
  new AppException(ErrorCodes.CONFLICT, message, { fieldErrors: { [field]: [note] } });

/** An attempt stores the option id it was shown, so a position that had one keeps it. */
function optionsWithIds(built: BuiltQuestion, previous: QuestionOption[]) {
  return built.options.map((option) => ({
    id: previous.find((old) => old.position === option.position)?.id ?? randomUUID(),
    position: option.position,
    isCorrect: option.isCorrect,
    text: option.text,
  }));
}

/** A version row from a built draft and the options its ids have already been merged into. */
function versionDataOf(
  questionId: string,
  version: number,
  built: BuiltQuestion,
  options: QuestionOption[],
  createdById: string,
): Prisma.QuestionVersionUncheckedCreateInput {
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
  content: string | null;
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
    content: contentHashOf(row),
  };
}

/** Short: it is read to spot a change, never to rebuild anything. */
const CONTENT_HASH_CHARS = 16;

/** jsonb returns keys in its own order, so a freshly built object and a stored one must be levelled. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonical(nested)]),
  );
}

/** Moves whenever what the question SAYS moves — which a draft's version number no longer does. */
function fingerprint(content: unknown, options: unknown, answerKey: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical([content, options, answerKey])))
    .digest('hex')
    .slice(0, CONTENT_HASH_CHARS);
}

function contentHashOf(row: QuestionRow): string | null {
  const version = row.currentVersion;
  return version ? fingerprint(version.content, version.options, version.answerKey) : null;
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
    author: row.createdBy
      ? { id: row.createdBy.id, name: row.createdBy.fullName ?? row.createdBy.email }
      : null,
    inUse: isReferenced(row),
    openFlags: row._count.flags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the lifecycle turns on, said once for the screen as well as for the rules. */
function isReferenced(row: QuestionRow): boolean {
  const counts = row._count;
  return counts.paperQuestions + counts.attemptItems + counts.questionStats > 0;
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
