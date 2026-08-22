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
  type QuestionIntakeStatus,
} from '@iace/contracts';
import { importFileKey, readUploadedTable } from '../common/importing';
import { AuditService } from '../audit';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildContent, type BuiltQuestion } from './question-core';
import {
  planQuestionImport,
  withoutDrafts,
  type ImportDedupContext,
  type PlannedRow,
  type QuestionImportPlanning,
} from './question-import';
import { buildQuestionTemplate } from './question-workbook';
import { loadTaxonomyCatalog } from './taxonomy-context';

/**
 * A sheet of questions, in two steps that share one plan.
 *
 * The file is uploaded ONCE: the preview stores it and opens an import run, and
 * the commit names that run rather than sending the same megabytes again. The
 * commit then re-reads the stored file and re-plans it — it never trusts a plan
 * the client hands back, because a client that can send a plan can send any plan,
 * and because the bank may have gained the same question in between.
 */
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

    // Keyed by the run, so the sheet that produced a set of questions can always
    // be fetched back — the answer to "where did this question come from".
    const key = importFileKey(AuditFeature.QUESTION, log.id);
    await this.storage.upload(key, file, XLSX_CONTENT_TYPE);
    await this.prisma.importLog.update({ where: { id: log.id }, data: { fileS3Key: key } });

    return withoutDrafts(planning, log.id);
  }

  async commit(importLogId: string, status: QuestionIntakeStatus): Promise<QuestionImportResult> {
    const log = await this.prisma.importLog.findUnique({ where: { id: importLogId } });
    if (!log || log.feature !== AuditFeature.QUESTION || !log.fileS3Key) {
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

    // Interactive, not an array of promises: every question is three statements — the row,
    // its first version, and the pointer between them — and all of them share one transaction.
    const created = await this.prisma.$transaction(async (tx) => {
      const rows: { id: string }[] = [];
      for (const row of creatable) {
        const built = buildContent(row.draft);
        const question = await tx.question.create({
          // The run decides the status, never the sheet: one file is one review decision.
          data: questionData({ ...row.draft, status }, built, log.actorId),
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
    });

    try {
      await this.audit.recordImportRows(
        log.id,
        AuditFeature.QUESTION,
        created.map((question) => ({ entityId: question.id, action: AUDIT_ACTION.CREATE })),
        log.actorId,
      );
    } catch (error) {
      // The questions are already durable; losing their audit rows is a cost, never a reason to
      // report an import that happened as one that did not.
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

    return planQuestionImport(table, catalog, await this.dedupContext());
  }

  /**
   * What the bank already holds, in two reads rather than two per row. Only the
   * hash and the code are needed, so even a large bank is a small payload.
   */
  private async dedupContext(): Promise<ImportDedupContext> {
    const rows = await this.prisma.question.findMany({
      where: { stemHash: { not: null } },
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

/**
 * The question row — identity and taxonomy only. Where it came from is the ImportLog and its
 * row actions, not a column here.
 */
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
    status: draft.status,
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
