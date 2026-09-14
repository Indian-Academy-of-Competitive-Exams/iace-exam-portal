/** What a commit stages, for the pre-commit checks that judge only the lines it adds. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIPPED = /(^|\/)(dist|node_modules|coverage)\//;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The 1-indexed line numbers this commit adds to a file, from the staged hunk headers. */
function addedLines(file) {
  const diff = git('diff', '--cached', '--unified=0', '--no-color', '--', file);
  const added = new Set();

  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i += 1) added.add(start + i);
  }
  return added;
}

/** Every staged file matching `pattern` that the commit adds lines to, as `{ file, source, added }`. */
export function stagedSources(pattern) {
  return git('diff', '--cached', '--name-only', '--diff-filter=ACM')
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => file && pattern.test(file) && !SKIPPED.test(file))
    .flatMap((file) => {
      let source;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        return [];
      }
      const added = addedLines(file);
      return added.size === 0 ? [] : [{ file, source, added }];
    });
}
