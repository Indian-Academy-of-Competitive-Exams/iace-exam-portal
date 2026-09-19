#!/usr/bin/env node
/**
 * Runs every workspace's tests with coverage and merges the reports.
 *
 * Two things this exists to handle:
 *
 * 1. Node writes `SF:` paths relative to the package that ran the tests
 *    (`src/auth/auth.service.ts`), while Sonar resolves them from the repo
 *    root. Unrewritten, every path misses and the whole report is silently
 *    discarded — which looks exactly like 0% coverage, and was.
 *
 * 2. Node's coverage only includes files a test actually LOADED. A file no test
 *    imports is absent from the report rather than present at 0%, so a package
 *    can report 94% while two thirds of it has never been executed. The summary
 *    printed at the end counts the files on disk, not the ones in the report.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, prepareTestDatabase } from './test-database.mjs';

/** Packages that have tests, and the command that runs them with coverage. */
const PACKAGES = [
  { dir: 'apps/api', env: { TSX_TSCONFIG_PATH: 'test/tsconfig.json' } },
  {
    // The services whose tests read and write Postgres are covered here, or Sonar sees them as untested.
    dir: 'apps/api',
    label: 'apps/api (db)',
    env: () => ({ ...prepareTestDatabase(), TSX_TSCONFIG_PATH: 'test/tsconfig.json' }),
    args: ['--test-concurrency=1'],
    globs: ['test-db/**/*.db.test.ts'],
    report: 'lcov-db.info',
  },
  { dir: 'packages/contracts', env: {} },
  {
    dir: 'packages/ui',
    env: { TSX_TSCONFIG_PATH: 'test/tsconfig.json' },
    // The component tests render into jsdom, installed before any test loads.
    imports: ['./test/support/dom.ts'],
    globs: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
  {
    dir: 'packages/app-kit',
    env: { TSX_TSCONFIG_PATH: 'test/tsconfig.json' },
    imports: ['@iace/ui/test-support/dom'],
    globs: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
  { dir: 'apps/admin', env: { TSX_TSCONFIG_PATH: 'test/tsconfig.json' } },
];

const RECORD_END = 'end_of_record\n';

/** Node writes `undefined` where it has no line for a branch, and Sonar counts each one an inconsistency. */
const UNPLACED = /^(?:BRDA|FN):undefined,.*\n/gm;

/** Mirrors sonar.sources and the dist exclusion: a path outside them resolves to nothing. */
const analysed = (file) => /^(apps|packages|prisma)\//.test(file) && !file.includes('/dist/');

const merged = [];
const summary = [];

for (const pkg of PACKAGES) {
  const cwd = join(ROOT, pkg.dir);
  const out = join(cwd, 'coverage');
  const lcovPath = join(out, pkg.report ?? 'lcov.info');
  const env = typeof pkg.env === 'function' ? pkg.env() : pkg.env;
  mkdirSync(out, { recursive: true });

  try {
    execFileSync(
      'node',
      [
        '--import',
        'tsx',
        ...(pkg.imports ?? []).flatMap((module) => ['--import', module]),
        '--test',
        ...(pkg.args ?? []),
        '--experimental-test-coverage',
        '--test-reporter=lcov',
        `--test-reporter-destination=${lcovPath}`,
        '--test-reporter=dot',
        '--test-reporter-destination=stdout',
        ...(pkg.globs ?? ['test/**/*.test.ts']),
      ],
      { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // A failing test still writes what it managed to cover. Reporting a merged
    // number from a red suite would be a lie, so this stops.
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
    console.error(`\n✗ tests failed in ${pkg.label ?? pkg.dir} — coverage not written`);
    process.exit(1);
  }

  if (!existsSync(lcovPath)) continue;

  // Rewrite each SF: to be repo-root relative, and drop what Sonar does not index — see the notes above.
  const body = readFileSync(lcovPath, 'utf8')
    .replaceAll(UNPLACED, '')
    .split(RECORD_END)
    .map((record) => record.replace(/^SF:(.+)$/m, (_line, file) => `SF:${join(pkg.dir, file)}`))
    .filter((record) => analysed(/^SF:(.+)$/m.exec(record)?.[1] ?? ''))
    .map((record) => record + RECORD_END)
    .join('');
  merged.push(body);

  summary.push({ dir: pkg.label ?? pkg.dir, ...filesIn(body, cwd, pkg.dir) });
}

mkdirSync(join(ROOT, 'coverage'), { recursive: true });
writeFileSync(join(ROOT, 'coverage/lcov.info'), merged.join('\n'));

console.log('\n  package             src files   executed by tests   never loaded');
for (const row of summary) {
  console.log(
    `  ${row.dir.padEnd(20)}${String(row.total).padStart(6)}${String(row.covered).padStart(20)}${String(row.total - row.covered).padStart(15)}`,
  );
}
console.log(`\n  merged report: coverage/lcov.info`);

/** How much of a package the report actually speaks for. */
function filesIn(lcov, cwd, dir) {
  const inReport = new Set([...lcov.matchAll(/^SF:(.+)$/gm)].map((m) => m[1]));
  const onDisk = sourceFiles(join(cwd, 'src')).map((f) => join(dir, relative(cwd, f)));
  return { total: onDisk.length, covered: onDisk.filter((f) => inReport.has(f)).length };
}

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .map((file) => join(dir, file));
}
