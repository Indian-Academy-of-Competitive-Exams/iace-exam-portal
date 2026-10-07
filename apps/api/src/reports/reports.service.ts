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
import { writeWorkbook } from '../common/exporting';
import { PrismaService } from '../prisma/prisma.service';
import {
  SittingFigures,
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

/** A student reads as nobody's admin: no report a super admin alone may open is theirs to ask for. */
const asThemselves = (studentId: string): ReportViewer => ({
  id: studentId,
  isSuperAdmin: false,
  isActive: true,
});

/** The read model behind every report. It writes nothing, and owns no table (docs/03 §4). */
@Injectable()
export class ReportsService {
  private readonly sources: ReportSources;

  constructor(
    prisma: PrismaService,
    access: AccessResolverService,
    audit: AuditService,
    figures: SittingFigures,
  ) {
    this.sources = {
      prisma,
      access,
      audit,
      analytics: figures.analytics,
      leaderboard: figures.leaderboard,
      performance: figures.performance,
      overview: figures.overview,
      attemptReport: figures.attemptReport,
      papers: figures.papers,
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
    return this.document(key, { ...query, studentId }, asThemselves(studentId));
  }

  /** The same report as a spreadsheet, and as much the caller's own. */
  async ownWorkbook(studentId: string, key: StudentReportKey, query: ReportQuery): Promise<Buffer> {
    const file = await this.workbook(key, { ...query, studentId }, asThemselves(studentId));
    return file.workbook;
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
