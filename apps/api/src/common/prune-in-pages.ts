import { type Logger } from '@nestjs/common';

/** Deleted a page at a time, so one run never holds a lock the size of the backlog. */
export async function pruneInPages(
  page: { size: number; max: number },
  idsOf: () => Promise<{ id: string }[]>,
  remove: (ids: string[]) => Promise<{ count: number }>,
  logger: Logger,
): Promise<number> {
  let removed = 0;
  for (let at = 0; at < page.max; at += 1) {
    const rows = await idsOf();
    if (rows.length === 0) return removed;
    removed += (await remove(rows.map((row) => row.id))).count;
    if (rows.length < page.size) return removed;
  }
  logger.warn(`Stopped after ${page.max} pages of pruning; the next run carries on`);
  return removed;
}
