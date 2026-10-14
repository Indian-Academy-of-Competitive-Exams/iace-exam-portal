import { Injectable } from '@nestjs/common';
import {
  AUDIT_FEATURE,
  EXPORT_KINDS,
  type AuditFeature,
  type ExportKind,
  type FieldDiff,
} from '@iace/contracts';
import { AccessResolverService, StudentGrantsService } from '../access';
import { StudentOverviewService, TestAnalyticsService, buildTestReport } from '../attempts';
import { AuditService } from '../audit';
import {
  REPORT_EXPORT,
  chosenFilters,
  type ExportRequest,
  type ExportViewer,
} from '../common/exporting';
import { AnnouncementsService } from '../notifications';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from '../questions';
import { ReportsService } from '../reports';
import { buildStudentExport } from '../students';

/** A finished file, and what its audit row says about it — written once the file exists. */
export interface BuiltExport {
  kind: ExportKind;
  workbook: Buffer;
  audit: { feature: AuditFeature; entityId: string; changed: FieldDiff };
}

/** An export only adds facts, so each one is a field that went from nothing to its value. */
const said = (facts: Record<string, unknown>): FieldDiff =>
  Object.fromEntries(Object.entries(facts).map(([field, to]) => [field, { from: null, to }]));

/** Each kind's owner builds its own file; this only routes the request to it. */
@Injectable()
export class ExportBuilders {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionsService,
    private readonly rollups: StudentOverviewService,
    private readonly reports: ReportsService,
    private readonly analytics: TestAnalyticsService,
    private readonly access: AccessResolverService,
    private readonly grants: StudentGrantsService,
    private readonly announcements: AnnouncementsService,
    private readonly audit: AuditService,
  ) {}

  async build(request: ExportRequest, viewer: ExportViewer): Promise<BuiltExport> {
    switch (request.kind) {
      case EXPORT_KINDS.QUESTIONS: {
        const { workbook, rows } = await this.questions.exportWorkbook(request.query);
        const changed = said({ filters: chosenFilters(request.query), rows });
        return {
          kind: request.kind,
          workbook,
          audit: { feature: AUDIT_FEATURE.QUESTION, entityId: viewer.id, changed },
        };
      }
      case EXPORT_KINDS.STUDENTS:
      case EXPORT_KINDS.STUDENT_PERFORMANCE: {
        const sources = { prisma: this.prisma, rollups: this.rollups };
        const { workbook, rows } = await buildStudentExport(sources, request.query);
        const changed = said({ filters: chosenFilters(request.query), rows });
        return {
          kind: request.kind,
          workbook,
          audit: { feature: AUDIT_FEATURE.STUDENT, entityId: viewer.id, changed },
        };
      }
      case REPORT_EXPORT: {
        const { key, query } = request;
        const { workbook, rows } = await this.reports.workbook(key, query, viewer);
        const changed = said({ report: key, filters: chosenFilters(query), rows });
        return {
          kind: key,
          workbook,
          audit: { feature: AUDIT_FEATURE.REPORT, entityId: viewer.id, changed },
        };
      }
      case EXPORT_KINDS.TEST_REPORT: {
        const sources = { prisma: this.prisma, analytics: this.analytics, access: this.access };
        const { workbook, results, absent } = await buildTestReport(sources, request.testId);
        const changed = said({ results, absent });
        return {
          kind: request.kind,
          workbook,
          audit: { feature: AUDIT_FEATURE.TEST, entityId: request.testId, changed },
        };
      }
      case EXPORT_KINDS.SERIES_GRANTS: {
        const { workbook, rows } = await this.grants.exportForSeries(request.seriesId);
        const audit = {
          feature: AUDIT_FEATURE.TEST_SERIES,
          entityId: request.seriesId,
          changed: said({ rows }),
        };
        return { kind: request.kind, workbook, audit };
      }
      case EXPORT_KINDS.ANNOUNCEMENT_DELIVERIES: {
        const { workbook, rows } = await this.announcements.exportDeliveries(
          request.announcementId,
        );
        const audit = {
          feature: AUDIT_FEATURE.ANNOUNCEMENT,
          entityId: request.announcementId,
          changed: said({ rows }),
        };
        return { kind: request.kind, workbook, audit };
      }
      case EXPORT_KINDS.AUDIT_LOG: {
        const { workbook, rows } = await this.audit.exportRowActions(request.query, viewer);
        // `rowActionWhere` ignores an admin's actor filter, so the log must not claim it was applied.
        const applied = viewer.isSuperAdmin
          ? request.query
          : { ...request.query, actorId: undefined };
        const changed = said({ filters: chosenFilters(applied), rows });
        return {
          kind: request.kind,
          workbook,
          audit: { feature: AUDIT_FEATURE.AUDIT_LOG, entityId: viewer.id, changed },
        };
      }
    }
  }
}
