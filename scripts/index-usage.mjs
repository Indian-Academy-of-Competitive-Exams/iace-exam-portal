/**
 * Which indexes a database has READ, from `pg_stat_user_indexes`.
 * Zero scans is a CANDIDATE, never a verdict: a test suite plans over too
 * little data to need an index, so run it where the traffic is.
 * node scripts/index-usage.mjs [--test] [--unused]
 */
import { PrismaClient } from '@prisma/client';
import { envValue } from './test-database.mjs';

const wants = new Set(process.argv.slice(2));
const url = envValue(wants.has('--test') ? 'TEST_DATABASE_URL' : 'DATABASE_URL');

if (!url) {
  console.error(
    'index-usage: no database url in .env — DATABASE_URL, or TEST_DATABASE_URL with --test.',
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: url });

const rows = await prisma.$queryRawUnsafe(`
  SELECT s.relname AS table_name,
         s.indexrelname AS index_name,
         s.idx_scan::int AS scans,
         pg_relation_size(s.indexrelid) AS bytes,
         i.indisunique AS is_unique,
         i.indisprimary AS is_primary
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
  WHERE s.schemaname = 'public'
  ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC`);

const kb = (bytes) => `${Math.round(Number(bytes) / 1024)} kB`;
const shown = wants.has('--unused') ? rows.filter((row) => row.scans === 0) : rows;
const dead = rows.filter((row) => row.scans === 0 && !row.is_primary && !row.is_unique);

for (const row of shown) {
  const badge = row.is_primary ? ' [pk]' : row.is_unique ? ' [unique]' : '';
  console.log(
    `${String(row.scans).padStart(9)}  ${kb(row.bytes).padStart(9)}  ${row.table_name}.${row.index_name}${badge}`,
  );
}

const wasted = dead.reduce((total, row) => total + Number(row.bytes), 0);
console.log(
  `\n${rows.length} indexes; ${dead.length} never read and neither a key nor a constraint (${kb(wasted)}).`,
);
console.log('Zero scans on a fresh or lightly used database means nothing — read the header.');

await prisma.$disconnect();
