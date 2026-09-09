/**
 * Every number is a `count()` on an indexed column or a read of a folded rollup. Nothing walks
 * `Attempt`: the sittings series is `TestStat` per recent live test, which the scoring workers
 * already fold. Reads cross the table-ownership map without writing (docs/03 §4).
 */
import { Injectable } from '@nestjs/common';
import { QuestionFlagStatus } from '@prisma/client';
import {
  DASHBOARD_FEED_ROWS,
  DASHBOARD_RECENT_TESTS,
  DASHBOARD_WINDOW_ROWS,
  QUESTION_STATUS,
  TEST_STATUS,
  rowActionListQuerySchema,
  type Dashboard,
  type DashboardActivity,
  type DashboardBank,
  type DashboardCoverage,
  type DashboardHeadline,
  type DashboardSitting,
  type DashboardWindow,
  type DashboardWindows,
  type DifficultyLevel,
  type QuestionStatus,
  type TestStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { isMissingTable } from '../common/prisma-errors';
import { AuditService } from '../audit';
import { type AuthenticatedUser } from '../common/security';
import { bandsFor, type DashboardBands } from './dashboard-bands';

const WINDOW_ORDER = { sort: 'desc', nulls: 'last' } as const;

/** The columns a window row and a sittings point both read off a test. */
const TEST_CARD = {
  id: true,
  title: true,
  opensAt: true,
  testSeries: { select: { name: true } },
} as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(user: AuthenticatedUser): Promise<Dashboard> {
    const bands = bandsFor(user);

    const [headline, bank, activity, windows] = await Promise.all([
      this.headline(bands),
      bands.bank ? this.bank() : undefined,
      this.activity(bands, user),
      bands.windows ? this.windows() : undefined,
    ]);

    return { headline, bank, activity, windows };
  }

  private async headline(bands: DashboardBands): Promise<DashboardHeadline | undefined> {
    if (!bands.students && !bands.questions && !bands.tests) return undefined;

    const [students, catalog, questions, tests] = await Promise.all([
      bands.students ? this.students() : undefined,
      bands.catalog ? this.catalog() : undefined,
      bands.questions ? this.questionsByStatus() : undefined,
      bands.tests ? this.tests() : undefined,
    ]);

    return { students, catalog, questions, tests };
  }

  private async students() {
    const [total, active] = await Promise.all([
      this.prisma.student.count({ where: { deletedAt: null } }),
      this.prisma.student.count({ where: { deletedAt: null, isActive: true } }),
    ]);
    return { total, active, suspended: total - active };
  }

  private async catalog() {
    const [branches, programs, exams] = await Promise.all([
      this.prisma.branch.count({ where: { deletedAt: null } }),
      this.prisma.program.count(),
      this.prisma.exam.count(),
    ]);
    return { branches, programs, exams };
  }

  private async questionsByStatus(): Promise<Partial<Record<QuestionStatus, number>>> {
    const rows = await this.prisma.question.groupBy({ by: ['status'], _count: true });
    return countsByKey(rows.map((row) => [row.status, row._count]));
  }

  private async tests() {
    const [rows, series] = await Promise.all([
      this.prisma.test.groupBy({ by: ['status'], _count: true }),
      this.prisma.testSeries.count(),
    ]);
    const byStatus: Partial<Record<TestStatus, number>> = countsByKey(
      rows.map((row) => [row.status, row._count]),
    );
    return { byStatus, series };
  }

  private async bank(): Promise<DashboardBank> {
    const [openFlags, coverage] = await Promise.all([this.openFlags(), this.coverage()]);

    // Omitted at zero, so the tile stays absent until proof-reading has raised a flag to act on.
    return { coverage, ...(openFlags > 0 ? { openFlags } : {}) };
  }

  /** Proof-reading is a later lane, so its table may not be in this database yet. */
  private async openFlags(): Promise<number> {
    try {
      return await this.prisma.questionFlag.count({ where: { status: QuestionFlagStatus.OPEN } });
    } catch (error) {
      if (isMissingTable(error)) return 0;
      throw error;
    }
  }

  private async coverage(): Promise<DashboardCoverage[]> {
    const [rows, subjects] = await Promise.all([
      this.prisma.question.groupBy({
        by: ['subjectId', 'difficulty'],
        where: { status: QUESTION_STATUS.ACTIVE },
        _count: true,
      }),
      this.prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);

    const held = new Map<string, Partial<Record<DifficultyLevel, number>>>();
    for (const row of rows) {
      const bucket = held.get(row.subjectId) ?? {};
      bucket[row.difficulty] = (bucket[row.difficulty] ?? 0) + row._count;
      held.set(row.subjectId, bucket);
    }

    return subjects.map((subject) => {
      const byDifficulty = held.get(subject.id) ?? {};
      return {
        subjectId: subject.id,
        subject: subject.name,
        active: Object.values(byDifficulty).reduce((sum, count) => sum + count, 0),
        byDifficulty,
      };
    });
  }

  private async activity(
    bands: DashboardBands,
    user: AuthenticatedUser,
  ): Promise<DashboardActivity | undefined> {
    if (!bands.feed) return undefined;

    const [feed, sittings] = await Promise.all([
      this.audit.listRowActions(rowActionListQuerySchema.parse({ pageSize: DASHBOARD_FEED_ROWS }), {
        id: user.id,
        isSuperAdmin: user.isSuperAdmin,
        isActive: user.isActive,
      }),
      bands.sittings ? this.sittings() : undefined,
    ]);

    return { feed: feed.items, sittings };
  }

  private async sittings(): Promise<DashboardSitting[]> {
    const rows = await this.prisma.test.findMany({
      where: { status: TEST_STATUS.ACTIVE },
      orderBy: { opensAt: WINDOW_ORDER },
      take: DASHBOARD_RECENT_TESTS,
      select: { ...TEST_CARD, stat: { select: { attemptCount: true, evaluatedCount: true } } },
    });

    // Oldest first: the series is read left to right, and the query had to sort the other way.
    return rows.reverse().map((row) => ({
      testId: row.id,
      title: row.title,
      opensAt: row.opensAt?.toISOString() ?? null,
      attempts: row.stat?.attemptCount ?? 0,
      evaluated: row.stat?.evaluatedCount ?? 0,
    }));
  }

  private async windows(): Promise<DashboardWindows> {
    const now = new Date();
    // A test in a series nobody can reach is not a window, however open its own clock is.
    const live = { status: TEST_STATUS.ACTIVE, testSeries: { isEnabled: true } } as const;

    const [open, upcoming] = await Promise.all([
      this.prisma.test.findMany({
        where: { ...live, OR: [{ opensAt: null }, { opensAt: { lte: now } }] },
        orderBy: { opensAt: WINDOW_ORDER },
        take: DASHBOARD_WINDOW_ROWS,
        select: TEST_CARD,
      }),
      this.prisma.test.findMany({
        where: { ...live, opensAt: { gt: now } },
        orderBy: { opensAt: 'asc' },
        take: DASHBOARD_WINDOW_ROWS,
        select: TEST_CARD,
      }),
    ]);

    return { open: open.map(asWindow), upcoming: upcoming.map(asWindow) };
  }
}

function asWindow(row: {
  id: string;
  title: string | null;
  opensAt: Date | null;
  testSeries: { name: string };
}): DashboardWindow {
  return {
    testId: row.id,
    title: row.title,
    series: row.testSeries.name,
    opensAt: row.opensAt?.toISOString() ?? null,
  };
}

function countsByKey<K extends string>(pairs: readonly (readonly [K, number])[]) {
  return Object.fromEntries(pairs) as Partial<Record<K, number>>;
}
