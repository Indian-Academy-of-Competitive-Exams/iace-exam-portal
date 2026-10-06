import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  type ReportCell,
  type ReportDocument,
  type ReportKey,
  type ReportQuery,
} from '@iace/contracts';
import { AccessResolverService } from '../../src/access/access-resolver.service';
import { AuditService } from '../../src/audit/audit.service';
import { AttemptReportService } from '../../src/attempts/attempt-report.service';
import { LeaderboardService } from '../../src/attempts/leaderboard.service';
import { StudentOverviewService } from '../../src/attempts/overview.service';
import { PaperSheetService } from '../../src/attempts/paper-sheet.service';
import { PerformanceAnalyticsService } from '../../src/attempts/performance.service';
import { RollupQueue } from '../../src/attempts/rollup-queue';
import { TestAnalyticsService } from '../../src/attempts/test-analytics.service';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { SittingFigures, type ReportViewer } from '../../src/reports/report';
import { ReportsService } from '../../src/reports/reports.service';
import { FakeQueue, FakeRedis, FakeStorage } from '../../test/support/fakes';

/** A fixed admin, so a row scoped to its actor can be written against it before the read. */
export const VIEWER: ReportViewer = { id: randomUUID(), isActive: true, isSuperAdmin: false };
export const SUPER_ADMIN: ReportViewer = { ...VIEWER, isSuperAdmin: true };

/** The reports service over the real database, with only Redis and the queue stood in for. */
export function reportsOver(prisma: PrismaService) {
  const access = new AccessResolverService(prisma, new FakeRedis().asService());
  const analytics = new TestAnalyticsService(
    prisma,
    new RollupQueue(new FakeQueue().asQueue()),
    access,
  );
  const leaderboard = new LeaderboardService(prisma);
  const papers = new PaperSheetService(prisma);
  const reports = new ReportsService(
    prisma,
    access,
    new AuditService(prisma, new FakeStorage() as never),
    new SittingFigures(
      analytics,
      leaderboard,
      new PerformanceAnalyticsService(prisma, leaderboard),
      new StudentOverviewService(prisma, leaderboard),
      new AttemptReportService(prisma, leaderboard, new FakeStorage() as never, papers),
      papers,
    ),
  );
  const read = (
    key: ReportKey,
    query: ReportQuery,
    viewer: ReportViewer = VIEWER,
  ): Promise<ReportDocument> => reports.document(key, query, viewer);
  return { reports, read };
}

/** One table of a document, a row an object keyed by its column. */
export function tableOf(document: ReportDocument, title: string): Record<string, ReportCell>[] {
  const table = document.tables.find((candidate) => candidate.title === title);
  assert.ok(table, `no table called ${title}`);
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((column, at) => [column, row[at] ?? null])),
  );
}

export const figureOf = (document: ReportDocument, label: string): ReportCell | undefined =>
  document.figures.find((figure) => figure.label === label)?.value;
