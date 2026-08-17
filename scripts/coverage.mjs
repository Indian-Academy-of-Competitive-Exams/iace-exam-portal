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

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Packages that have tests, and the command that runs them with coverage. */
const PACKAGES = [
  { dir: 'apps/api', env: { TSX_TSCONFIG_PATH: 'test/tsconfig.json' } },
  { dir: 'packages/contracts', env: {} },
  {
    dir: 'packages/ui',
    env: { TSX_TSCONFIG_PATH: 'test/tsconfig.json' },
    // The component tests render into jsdom, installed before any test loads.
    imports: ['./test/support/dom.ts'],
    globs: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
  { dir: 'packages/app-kit', env: {} },
];

const merged = [];
const summary = [];

for (const pkg of PACKAGES) {
  const cwd = join(ROOT, pkg.dir);
  const out = join(cwd, 'coverage');
  mkdirSync(out, { recursive: true });

  try {
    execFileSync(
      'node',
      [
        '--import',
        'tsx',
        ...(pkg.imports ?? []).flatMap((module) => ['--import', module]),
        '--test',
        '--experimental-test-coverage',
        '--test-reporter=lcov',
        `--test-reporter-destination=${join(out, 'lcov.info')}`,
        '--test-reporter=dot',
        '--test-reporter-destination=stdout',
        ...(pkg.globs ?? ['test/**/*.test.ts']),
      ],
      { cwd, env: { ...process.env, ...pkg.env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // A failing test still writes what it managed to cover. Reporting a merged
    // number from a red suite would be a lie, so this stops.
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
    console.error(`\n✗ tests failed in ${pkg.dir} — coverage not written`);
    process.exit(1);
  }

  const lcovPath = join(out, 'lcov.info');
  if (!existsSync(lcovPath)) continue;

  // Rewrite each SF: to be repo-root relative — see the note above.
  const body = readFileSync(lcovPath, 'utf8').replace(
    /^SF:(.+)$/gm,
    (_line, file) => `SF:${join(pkg.dir, file)}`,
  );
  merged.push(body);

  summary.push({ dir: pkg.dir, ...filesIn(body, cwd, pkg.dir) });
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
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}
