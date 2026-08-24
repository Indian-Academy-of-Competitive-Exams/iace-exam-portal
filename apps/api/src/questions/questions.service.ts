import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppException,
  ErrorCodes,
  FORM_LEVEL_FIELD,
  QUESTION_STATUS,
  fieldDiff,
  plainTextOf,
  type LocalizedContent,
  type Paginated,
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
} from './question-images';
import { mapQuestionHtml, rewriteQuestionHtml } from './question-content';
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
  currentVersion: true,
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
    const keys = new Set(mapQuestionHtml(detail, (html) => html).flatMap(imageKeysIn));
    if (keys.size === 0) return detail;

    const urls = new Map(
      await Promise.all(
        [...keys].map(
          async (key) =>
            [key, await this.storage.createDownloadUrl(key, QUESTION_IMAGE_URL_TTL_SEC)] as const,
        ),
      ),
    );

    return rewriteQuestionHtml(detail, (html) => applyImageUrls(html, urls));
  }

  /** Hands back the KEY that content quotes, plus a url that only shows what was just picked. */
  async saveImage(file: { buffer: Buffer; size: number; mimetype: string } | undefined) {
    checkQuestionImage(file);

    const key = questionImageKey(file.mimetype);
    await this.storage.upload(key, file.buffer, file.mimetype);

    return { key, url: await this.storage.createDownloadUrl(key, QUESTION_IMAGE_URL_TTL_SEC) };
  }

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
    return this.signed(toDetail(await this.require(id)));
  }

  async create(draft: QuestionDraft, createdById: string): Promise<QuestionDetail> {
    assertIntakeStatus(draft.status);
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, null);

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
  async update(id: string, draft: QuestionDraft, createdById: string): Promise<QuestionDetail> {
    const question = await this.require(id);
    assertStatusMove(question.status, draft.status);
    const built = await this.validated(draft);
    await this.assertNotDuplicate(built.stemHash, id);

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
    assertStatusMove(question.status, draft.status);

    // Conditional, so it takes the row's lock — an approval landing mid-save must not be overwritten.
    const claimed = await tx.question.updateMany({
      where: { id, status: question.status },
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
    assertStatusMove(question.status, body.status);
    const updated = await this.prisma.question.update({
      where: { id },
      data: { status: body.status },
      include: QUESTION_INCLUDE,
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

  /** The one hard delete: a draft nobody drew, nobody sat and nothing measured. */
  async remove(id: string): Promise<void> {
    const before = await this.require(id);
    assertDeletable(before.status);

    await this.prisma.$transaction(async (tx) => {
      // Conditional: it takes the row's lock, re-asserts DRAFT, and clears the RESTRICTing pointer.
      const claimed = await tx.question.updateMany({
        where: { id, status: QUESTION_STATUS.DRAFT },
        data: { currentVersionId: null },
      });
      if (claimed.count !== 1) {
        // Through `tx`: the pool client would want a second connection while this one holds the lock.
        const current = await tx.question.findUnique({ where: { id } });
        if (!current) throw new AppException(ErrorCodes.NOT_FOUND, 'No such question');
        assertDeletable(current.status);
        throw editedElsewhere();
      }

      if (await this.isUsed(tx, id)) {
        throw refused(
          'This question is already part of a paper or an attempt, so it cannot be deleted.',
          'Something already uses this question',
        );
      }

      await tx.questionVersion.deleteMany({ where: { questionId: id } });
      await tx.question.delete({ where: { id } });
    });

    this.auditContext.setChanged({ status: { from: before.status, to: 'DELETED' } });
  }

  /** Every table that keys on the question, so the rule refuses before a foreign key does. */
  private async isUsed(tx: Prisma.TransactionClient, questionId: string): Promise<boolean> {
    const [papers, attempts, stats] = await Promise.all([
      tx.paperQuestion.count({ where: { questionId } }),
      tx.attemptQuestion.count({ where: { questionId } }),
      tx.testQuestionStat.count({ where: { questionId } }),
    ]);
    return papers + attempts + stats > 0;
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
    const blocked = BLOCKED_BEFORE[status];
    if (!blocked) return;

    const rows = await tx.question.findMany({
      where: { id: { in: ids }, status: blocked },
      take: 1,
    });
    if (rows[0]) assertStatusMove(rows[0].status, status);
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

/** ARCHIVED is a retirement, so nothing arrives in it — the one status a question cannot start in. */
function assertIntakeStatus(status: QuestionStatus | undefined): void {
  if (status !== QUESTION_STATUS.ARCHIVED) return;
  throw refused('A question cannot be created as archived.', 'Create it as a draft or as active');
}

/** Only a draft: anything that was ever in circulation is archived, so a paper can still read it. */
function assertDeletable(status: QuestionStatus): void {
  if (status === QUESTION_STATUS.DRAFT) return;
  throw refused(
    'Only a draft can be deleted. Archive this question instead.',
    'This question is no longer a draft',
  );
}

/** The status a row may NOT already be in, for each status a batch can move it to. */
const BLOCKED_BEFORE: Partial<Record<QuestionStatus, Prisma.QuestionWhereInput['status']>> = {
  [QUESTION_STATUS.DRAFT]: { not: QUESTION_STATUS.DRAFT },
  [QUESTION_STATUS.ARCHIVED]: QUESTION_STATUS.DRAFT,
};

/** Publishing is one-way, and only what was in circulation can be taken out of it. */
function assertStatusMove(from: QuestionStatus, to: QuestionStatus | undefined): void {
  if (to === undefined || to === from) return;

  if (to === QUESTION_STATUS.DRAFT) {
    throw refused(
      'A question that has been published cannot go back to draft. Archive it instead.',
      'This question has already been published',
    );
  }
  if (to === QUESTION_STATUS.ARCHIVED && from === QUESTION_STATUS.DRAFT) {
    throw refused(
      'A draft was never in circulation, so there is nothing to archive.',
      'This question is still a draft',
    );
  }
}

/** Someone else moved the row between reading it and writing it; the save is not silently applied. */
const editedElsewhere = () =>
  refused(
    'Somebody else changed this question while you were working on it. Open it again.',
    'This question changed while you were editing it',
  );

const refused = (message: string, field: string) =>
  new AppException(ErrorCodes.CONFLICT, message, { fieldErrors: { status: [field] } });

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
