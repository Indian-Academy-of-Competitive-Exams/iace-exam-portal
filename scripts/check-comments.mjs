/**
 * The one-line comment rule (docs/superpowers/task-constraints.md), enforced.
 *
 * A comment explains an external constraint, a genuinely surprising line, or an invariant the types
 * cannot carry. One line is enough for all three. Anything longer is almost always describing what
 * the code does, which is a rename waiting to happen.
 *
 * Only the lines a commit ADDS are judged. The repo carries ~874 multi-line comments written before
 * this rule; rewriting them would touch 290 files, change no behaviour and truncate the few that
 * genuinely earn their length. They are grandfathered, and touching one line inside one opts that
 * block back in.
 *
 * Exempt, because they are maps rather than explanations: the block at the very top of a file, and
 * section banners (a comment carrying a ----- or ===== divider). Only code files are read at all,
 * so the SQL migrations task-constraints.md exempts by name never reach this.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHECKED = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED = /(^|\/)(dist|node_modules|coverage)\//;
const DIVIDER = /^\s*(\/\/|\*|\/\*)[\s*]*[-=]{8,}/;
const MAX_LINES = 1;

/** A file's map, not a place to put the essay the one-line rule refused. */
const MAX_HEADER_LINES = 6;

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

/** Every comment block in a file, as { start, end, lines, banner }. */
function commentBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  let open = null;

  const close = () => {
    if (open) blocks.push(open);
    open = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const trimmed = text.trim();
    const banner = DIVIDER.test(text);

    if (open?.block) {
      open.end = i + 1;
      open.banner ||= banner;
      if (trimmed.includes('*/')) close();
      continue;
    }

    if (trimmed.startsWith('/*')) {
      open = { start: i + 1, end: i + 1, block: true, banner };
      if (trimmed.includes('*/')) close();
      continue;
    }

    if (trimmed.startsWith('//')) {
      open ??= { start: i + 1, end: i + 1, block: false, banner: false };
      open.end = i + 1;
      open.banner ||= banner;
      continue;
    }

    close();
  }
  close();

  return blocks.map((b) => ({ ...b, lines: b.end - b.start + 1 }));
}

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACM')
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && CHECKED.test(f) && !SKIPPED.test(f));

const offences = [];

for (const file of staged) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const added = addedLines(file);
  if (added.size === 0) continue;

  for (const block of commentBlocks(source)) {
    if (block.lines <= MAX_LINES) continue;
    if (block.banner) continue;
    // The block at the very top of a file is its map — bounded, or it becomes the loophole.
    if (block.start === 1 && block.lines <= MAX_HEADER_LINES) continue;

    let touched = false;
    for (let line = block.start; line <= block.end && !touched; line += 1) {
      touched = added.has(line);
    }
    if (touched) offences.push({ file, ...block });
  }
}

if (offences.length > 0) {
  console.error(`\n✗ ${offences.length} multi-line comment(s) in what this commit adds.\n`);
  console.error('  One line per comment. If it does not fit, the code needs a better name —');
  console.error('  see docs/superpowers/task-constraints.md.\n');
  for (const o of offences) {
    console.error(`  ${o.file}:${o.start}  ${o.lines} lines`);
  }
  console.error(
    `\n  Exempt: ----- / ===== section banners, and a file's top block up to ${MAX_HEADER_LINES} lines.\n`,
  );
  process.exit(1);
}
