import { Prisma } from '@prisma/client';
import { TEST_SERIES_KIND, type TestSeriesKind } from '@iace/contracts';

/** branchIds follows the BranchTestConfig rows; isEnabled has ONE owner, so it moves only when told. */
export async function mirrorSwitchOntoSeries(
  tx: Prisma.TransactionClient,
  testSeriesIds: readonly string[],
  chosen?: boolean,
): Promise<void> {
  const ids = [...new Set(testSeriesIds)];
  if (ids.length === 0) return;

  const rows = await tx.testSeries.findMany({ where: { id: { in: ids } }, select: KIND_ONLY });
  const enabled = await tx.branchTestConfig.findMany({
    where: { testSeriesId: { in: ids }, enabled: true },
    select: { testSeriesId: true, branchId: true },
  });

  const branches = groupBranches(enabled);

  for (const row of rows) {
    // Only STANDARD reaches through a branch; every other kind reaches past one, so its list is empty.
    const standard = row.kind === TEST_SERIES_KIND.STANDARD;
    await tx.testSeries.update({
      where: { id: row.id },
      data: {
        branchIds: standard ? (branches.get(row.id) ?? []) : [],
        ...(chosen === undefined ? {} : { isEnabled: chosen }),
      },
    });
  }
}

/** What a series is worth switching on AS it is created: a kind reaching past branches has nothing to wait for. */
export const startsSwitchedOn = (kind: TestSeriesKind): boolean =>
  kind !== TEST_SERIES_KIND.STANDARD;

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
