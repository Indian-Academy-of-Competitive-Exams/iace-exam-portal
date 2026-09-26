/** Postgres binds at most 32,767 parameters a statement, and an export may name 50,000 ids. */
export const IDS_PER_READ = 10_000;

/** One read per slice of ids, in order; each slice stays well under the bind limit. */
export async function readInBatches<T>(
  ids: readonly string[],
  read: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let at = 0; at < ids.length; at += IDS_PER_READ) {
    rows.push(...(await read(ids.slice(at, at + IDS_PER_READ))));
  }
  return rows;
}
