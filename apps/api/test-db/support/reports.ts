import assert from 'node:assert/strict';
import {
  type AdminAuthority,
  type ReportCell,
  type ReportDocument,
  type ReportKey,
  type ReportQuery,
} from '@iace/contracts';
import { AccessResolverService } from '../../src/access/access-resolver.service';
import { LeaderboardService } from '../../src/attempts/leaderboard.service';
import { RollupQueue } from '../../src/attempts/rollup-queue';
import { TestAnalyticsService } from '../../src/attempts/test-analytics.service';
import { type PrismaService } from '../../src/prisma/prisma.service';
import { ReportsService } from '../../src/reports/reports.service';
import { FakeQueue, FakeRedis } from '../../test/support/fakes';

export const VIEWER: AdminAuthority = { isActive: true, isSuperAdmin: false, permissions: {} };
export const SUPER_ADMIN: AdminAuthority = { ...VIEWER, isSuperAdmin: true };

/** The reports service over the real database, with only Redis and the queue stood in for. */
export function reportsOver(prisma: PrismaService) {
  const access = new AccessResolverService(prisma, new FakeRedis().asService());
  const analytics = new TestAnalyticsService(
    prisma,
    new RollupQueue(new FakeQueue().asQueue()),
    access,
  );
  const reports = new ReportsService(prisma, analytics, access, new LeaderboardService(prisma));
  const read = (
    key: ReportKey,
    query: ReportQuery,
    viewer: AdminAuthority = VIEWER,
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
