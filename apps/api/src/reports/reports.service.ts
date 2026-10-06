import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  REPORTS,
  reportFieldsMissing,
  type Paginated,
  type ReportChoice,
  type ReportChoiceParam,
  type ReportChoicesQuery,
  type ReportDocument,
  type ReportKey,
  type ReportQuery,
  type ReportSpec,
  type StudentReportKey,
} from '@iace/contracts';
import { AccessResolverService } from '../access';
import { AuditService } from '../audit';
import {
  AttemptReportService,
  LeaderboardService,
  PaperSheetService,
  PerformanceAnalyticsService,
  StudentOverviewService,
  TestAnalyticsService,
} from '../attempts';
import { writeWorkbook } from '../common/exporting';
import { PrismaService } from '../prisma/prisma.service';
import {
  aboutSheet,
  rowsIn,
  toDocument,
  type Report,
  type ReportBuilder,
  type ReportBuilders,
  type ReportSources,
  type ReportViewer,
} from './report';
import { COHORT_REPORTS } from './cohort-reports';
import { CONTENT_REPORTS } from './content-reports';
import { DIGEST_REPORTS } from './digest-report';
import { OPERATIONS_REPORTS } from './operations-reports';
import { ENROLMENT_REPORTS } from './enrolment-reports';
import { PERIOD_REPORTS } from './period-reports';
import { reportChoices } from './report-choices';
import { STUDENT_REPORTS } from './student-reports';
import { TEST_REPORTS } from './test-reports';

const BUILDERS: ReportBuilders = {
  ...TEST_REPORTS,
  ...PERIOD_REPORTS,
  ...STUDENT_REPORTS,
  ...COHORT_REPORTS,
  ...ENROLMENT_REPORTS,
  ...CONTENT_REPORTS,
  ...OPERATIONS_REPORTS,
  ...DIGEST_REPORTS,
};

/** The read model behind every report. It writes nothing, and owns no table (docs/03 §4). */
@Injectable()
export class ReportsService {
  private readonly sources: ReportSources;

  constructor(
    prisma: PrismaService,
    analytics: TestAnalyticsService,
    access: AccessResolverService,
    leaderboard: LeaderboardService,
    performance: PerformanceAnalyticsService,
    overview: StudentOverviewService,
    attemptReport: AttemptReportService,
    papers: PaperSheetService,
    audit: AuditService,
  ) {
    this.sources = {
      prisma,
      analytics,
      access,
      leaderboard,
      performance,
      overview,
      attemptReport,
      papers,
      audit,
    };
  }

  choices(param: ReportChoiceParam, query: ReportChoicesQuery): Promise<Paginated<ReportChoice>> {
    return reportChoices(this.sources.prisma, param, query);
  }

  async document(
    key: ReportKey,
    query: ReportQuery,
    viewer: ReportViewer,
  ): Promise<ReportDocument> {
    return toDocument(key, await this.build(key, query, viewer));
  }

  /** A student's own report: whatever the query says, the student is the caller. */
  own(studentId: string, key: StudentReportKey, query: ReportQuery): Promise<ReportDocument> {
    return this.document(
      key,
      { ...query, studentId },
      { id: studentId, isSuperAdmin: false, isActive: true },
    );
  }

  async workbook(
    key: ReportKey,
    query: ReportQuery,
    viewer: ReportViewer,
  ): Promise<{ workbook: Buffer; rows: number }> {
    const report = await this.build(key, query, viewer);
    const workbook = await writeWorkbook([aboutSheet(key, report), ...report.sheets]);
    return { workbook, rows: rowsIn(report) };
  }

  private build(key: ReportKey, query: ReportQuery, viewer: ReportViewer): Promise<Report> {
    const spec: ReportSpec = REPORTS[key];
    if (spec.superAdminOnly && !viewer.isSuperAdmin) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'Only a super admin may open this report');
    }
    const missing = reportFieldsMissing(key, query);
    if (missing.length > 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'This report needs more to go on', {
        fieldErrors: Object.fromEntries(missing.map((field) => [field, ['Required']])),
      });
    }
    // The catalogue row was just checked, which is all each builder's narrower query assumes.
    return (BUILDERS[key] as ReportBuilder)(this.sources, query, viewer);
  }
}
