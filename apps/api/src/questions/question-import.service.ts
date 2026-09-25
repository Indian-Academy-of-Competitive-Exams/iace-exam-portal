import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditFeature, ImportSource, Prisma } from '@prisma/client';
import {
  AppException,
  AUDIT_ACTION,
  ErrorCodes,
  IMPORT_LOG_STATUS,
  QUESTION_IMPORT_SHEETS,
  XLSX_CONTENT_TYPE,
  type QuestionImportPlan,
  type QuestionImportResult,
} from '@iace/contracts';
import { importFileKey, readUploadedTable } from '../common/importing';
import { AuditService } from '../audit';
import { requireOwnAssignment } from './assignment-guard';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildContent, type BuiltQuestion } from './question-core';
import {
  NO_DEDUP,
  planQuestionImport,
  withoutDrafts,
  type ImportDedupContext,
  type PlannedRow,
  type QuestionImportPlanning,
} from './question-import';
import { buildQuestionTemplate } from './question-workbook';
import { loadTaxonomyCatalog } from './taxonomy-context';

/** A sheet of questions, in two steps that share one plan: the file is uploaded ONCE, the preview stores it and opens an import run, and the commit names that run and re-reads and re-plans the stored file rather than trusting a plan the client hands back or sending the same megabytes again — a client that can send a plan can send any plan, and the bank may have gained the same question in between. */
@Injectable()
export class QuestionImportService {
  private readonly logger = new Logger(QuestionImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Generated per request: it carries the taxonomy as it stands right now. */
  async template(): Promise<Buffer> {
    return buildQuestionTemplate(await loadTaxonomyCatalog(this.prisma));
  }

  async preview(file: Buffer, actorId: string): Promise<QuestionImportPlan> {
    const planning = await this.plan(file);

    const log = await this.prisma.importLog.create({
      data: {
        feature: AuditFeature.QUESTION,
        source: ImportSource.SHEET,
        actorId,
        total: planning.summary.total,
        status: IMPORT_LOG_STATUS.PREVIEWED,
        errors: fileErrorsOf(planning),
      },
    });

    // Keyed by the run, so the sheet that produced a set of questions can always be fetched back — the answer to "where did this question come from".
    const key = importFileKey(AuditFeature.QUESTION, log.id);
    await this.storage.upload(key, file, XLSX_CONTENT_TYPE);
    await this.prisma.importLog.update({ where: { id: log.id }, data: { fileS3Key: key } });

    return withoutDrafts(planning, log.id);
  }

  /** The same sheet, landing in one section rather than loose in the bank. */
  async previewForAssignment(
    assignmentId: string,
    file: Buffer,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<QuestionImportPlan> {
    await requireOwnAssignment(this.prisma, assignmentId, adminId, isSuperAdmin);
    return this.preview(file, adminId);
  }

  async commitForAssignment(
    assignmentId: string,
    importLogId: string,
    adminId: string,
    isSuperAdmin: boolean,
  ): Promise<QuestionImportResult> {
    await requireOwnAssignment(this.prisma, assignmentId, adminId, isSuperAdmin);
    return this.commit(importLogId, { assignmentId, actorId: adminId });
  }

  async commit(importLogId: string, into: ImportTarget = {}): Promise<QuestionImportResult> {
    const log = await this.prisma.importLog.findUnique({ where: { id: importLogId } });
    if (!log || log.feature !== AuditFeature.QUESTION || !log.fileS3Key) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That upload is no longer available');
    }
    // A section's import commits the sheet that section's own typist previewed, never another's.
    if (into.actorId !== undefined && log.actorId !== into.actorId) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That upload is no longer available');
    }
    if (log.status === IMPORT_LOG_STATUS.COMMITTED) {
      throw new AppException(ErrorCodes.CONFLICT, 'That file has already been imported');
    }

    const planning = await this.plan(await this.storage.read(log.fileS3Key));
    const creatable = planning.rows.filter(
      (row): row is PlannedRow & { draft: NonNullable<PlannedRow['draft']> } =>
        row.action === 'create' && row.draft !== null,
    );

    // Interactive, not an array of promises: every question is three statements — the row, its first version, and the pointer between them — and all of them share one transaction.
    const created = await this.prisma.$transaction(async (tx) => {
      const rows: { id: string }[] = [];
      for (const row of creatable) {
        const built = buildContent(row.draft);
        const question = await tx.question.create({
          data: { ...questionData(row.draft, built, log.actorId), assignmentId: into.assignmentId },
        });
        const version = await tx.questionVersion.create({
          data: versionData(question.id, built, log.actorId),
        });
        await tx.question.update({
          where: { id: question.id },
          data: { currentVersionId: version.id },
        });
        rows.push(question);
      }
      return rows;
    }, TX_LIMITS.BULK);

    try {
      await this.audit.recordImportRows(
        log.id,
        AuditFeature.QUESTION,
        created.map((question) => ({ entityId: question.id, action: AUDIT_ACTION.CREATE })),
        log.actorId,
      );
    } catch (error) {
      // The questions are already durable; losing their audit rows is a cost, never a reason to report an import that happened as one that did not.
      this.logger.error(`Row actions for import ${log.id} were not recorded`, error);
    }

    const result: QuestionImportResult = {
      ...planning.summary,
      created: creatable.length,
      skipped: planning.summary.total - creatable.length,
    };

    await this.prisma.importLog.update({
      where: { id: log.id },
      data: {
        total: planning.summary.total,
        created: result.created,
        skipped: planning.summary.duplicates,
        failed: planning.summary.invalid,
        status: IMPORT_LOG_STATUS.COMMITTED,
        finishedAt: new Date(),
        errors: fileErrorsOf(planning),
      },
    });

    return result;
  }

  /** Read, resolve, judge — the one path a preview and a commit both take. */
  private async plan(file: Buffer): Promise<QuestionImportPlanning> {
    const table = await readUploadedTable(file, {
      preferSheet: QUESTION_IMPORT_SHEETS.QUESTIONS,
    });
    const catalog = await loadTaxonomyCatalog(this.prisma);

    // Planned twice: the first pass only harvests the keys the bank is then asked about.
    const harvest = planQuestionImport(table, catalog, NO_DEDUP);
    return planQuestionImport(table, catalog, await this.dedupContext(harvest.rows));
  }

  /** Only the rows this sheet could clash with: the whole bank was read to answer a few hundred asks. */
  private async dedupContext(planned: readonly PlannedRow[]): Promise<ImportDedupContext> {
    const hashes = planned.flatMap((row) => (row.stemHash === null ? [] : [row.stemHash]));
    const codes = planned.flatMap((row) => (row.questionCode === null ? [] : [row.questionCode]));
    if (hashes.length === 0 && codes.length === 0) return NO_DEDUP;

    const rows = await this.prisma.question.findMany({
      where: { OR: [{ stemHash: { in: hashes } }, { questionCode: { in: codes } }] },
      select: { id: true, stemHash: true, questionCode: true },
    });

    const questionIdByHash = new Map<string, string>();
    const questionIdByCode = new Map<string, string>();
    for (const row of rows) {
      if (row.stemHash && !questionIdByHash.has(row.stemHash)) {
        questionIdByHash.set(row.stemHash, row.id);
      }
      if (row.questionCode) questionIdByCode.set(row.questionCode, row.id);
    }

    return { questionIdByHash, questionIdByCode };
  }
}

/** The question row — identity and taxonomy only. Where it came from is the ImportLog and its row actions, not a column here. */
function questionData(
  draft: NonNullable<PlannedRow['draft']>,
  built: BuiltQuestion,
  actorId: string | null,
): Prisma.QuestionUncheckedCreateInput {
  return {
    type: draft.type,
    subjectId: draft.subjectId,
    topicId: draft.topicId ?? null,
    difficulty: draft.difficulty,
    questionCode: draft.questionCode ?? null,
    tags: draft.tags,
    stemHash: built.stemHash,
    createdById: actorId,
  };
}

/** Version 1: everything an imported question actually says. */
function versionData(
  questionId: string,
  built: BuiltQuestion,
  actorId: string | null,
): Prisma.QuestionVersionUncheckedCreateInput {
  return {
    questionId,
    version: 1,
    createdById: actorId,
    content: built.content as Prisma.InputJsonValue,
    options: built.options.map((option) => ({
      id: randomUUID(),
      ...option,
    })) as unknown as Prisma.InputJsonValue,
    answerKey: (built.answerKey ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
}

/** What was wrong with the FILE, kept on the run so the history explains itself. */
function fileErrorsOf(planning: QuestionImportPlanning): Prisma.InputJsonValue | undefined {
  return planning.fileErrors.length > 0 ? { fileErrors: planning.fileErrors } : undefined;
}

/** Where an imported sheet lands: the bank by default, or one section's own authoring. */
export interface ImportTarget {
  assignmentId?: string;
  /** Whose upload it has to be. Absent on the bank's importer, which nobody scopes. */
  actorId?: string;
}
