import { Prisma } from '@prisma/client';
import { TEST_SERIES_KIND } from '@iace/contracts';

/** The resolver reads `branchIds`/`isEnabled`; admins write `BranchTestConfig` and `StudentGrant`. */
export async function mirrorSwitchOntoSeries(
  tx: Prisma.TransactionClient,
  testSeriesIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(testSeriesIds)];
  if (ids.length === 0) return;

  const rows = await tx.testSeries.findMany({ where: { id: { in: ids } }, select: KIND_ONLY });
  const enabled = await tx.branchTestConfig.findMany({
    where: { testSeriesId: { in: ids }, enabled: true },
    select: { testSeriesId: true, branchId: true },
  });
  const grants = await tx.studentGrant.findMany({
    where: { testSeriesId: { in: ids } },
    select: { testSeriesId: true },
  });

  const branches = groupBranches(enabled);
  const granted = new Set(grants.map((row) => row.testSeriesId));

  for (const row of rows) {
    // Only STANDARD reaches through a branch; every other kind reaches past one, so its list is empty.
    const standard = row.kind === TEST_SERIES_KIND.STANDARD;
    const branchIds = standard ? (branches.get(row.id) ?? []) : [];
    await tx.testSeries.update({
      where: { id: row.id },
      data: { branchIds, isEnabled: !standard || branchIds.length > 0 || granted.has(row.id) },
    });
  }
}

const KIND_ONLY = { id: true, kind: true } as const satisfies Prisma.TestSeriesSelect;

function groupBranches(
  rows: readonly { testSeriesId: string; branchId: string }[],
): Map<string, string[]> {
  const branches = new Map<string, string[]>();
  for (const row of rows) {
    branches.set(row.testSeriesId, [...(branches.get(row.testSeriesId) ?? []), row.branchId]);
  }
  return branches;
}
