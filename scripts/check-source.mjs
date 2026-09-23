/**
 * The two source rules a commit is judged by, on the lines it ADDS: one line per comment
 * (docs/superpowers/task-constraints.md), and no hint that only repeats its label. Older
 * multi-line blocks are grandfathered; touching a line inside one opts that block back in.
 * Exempt: a file's top block and section banners, which are maps rather than explanations.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let failed = false;

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
function stagedSources(pattern) {
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

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const DIVIDER = /^\s*(\/\/|\*|\/\*)[\s*]*[-=]{8,}/;
const MAX_LINES = 1;

/** A file's map, not a place to put the essay the one-line rule refused. */
const MAX_HEADER_LINES = 6;

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

const commentOffences = [];

for (const { file, source, added } of stagedSources(CODE)) {
  for (const block of commentBlocks(source)) {
    if (block.lines <= MAX_LINES) continue;
    if (block.banner) continue;
    // The block at the very top of a file is its map — bounded, or it becomes the loophole.
    if (block.start === 1 && block.lines <= MAX_HEADER_LINES) continue;

    let touched = false;
    for (let line = block.start; line <= block.end && !touched; line += 1) {
      touched = added.has(line);
    }
    if (touched) commentOffences.push({ file, ...block });
  }
}

if (commentOffences.length > 0) {
  console.error(`\n✗ ${commentOffences.length} multi-line comment(s) in what this commit adds.\n`);
  console.error('  One line per comment. If it does not fit, the code needs a better name —');
  console.error('  see docs/superpowers/task-constraints.md.\n');
  for (const o of commentOffences) {
    console.error(`  ${o.file}:${o.start}  ${o.lines} lines`);
  }
  console.error(
    `\n  Exempt: ----- / ===== section banners, and a file's top block up to ${MAX_HEADER_LINES} lines.\n`,
  );
  failed = true;
}

const SCREENS = /\.tsx$/;

/** Words too common to prove a hint is echoing its label. */
const STOP_WORDS = new Set(
  `a an and the this that your you is are it its of to for in on with be will
   enter choose pick select type`.split(/\s+/),
);

const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );

const hintOffences = [];

for (const { file, source, added } of stagedSources(SCREENS)) {
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    if (!added.has(index + 1)) return;

    // A hint whose words are already in the label beside it.
    const hint = /\bhint="([^"]+)"/.exec(line);
    if (!hint) return;
    const nearby = lines.slice(Math.max(0, index - 6), index + 7).join(' ');
    const label = /\blabel="([^"]+)"/.exec(nearby);
    if (!label) return;

    const hintWords = words(hint[1]);
    if (hintWords.size === 0) return;
    const labelWords = words(label[1]);
    const echoed = [...hintWords].filter((word) => labelWords.has(word));
    if (echoed.length === hintWords.size) {
      hintOffences.push(`${file}:${index + 1}  hint "${hint[1]}" only repeats label "${label[1]}"`);
    }
  });
}

if (hintOffences.length > 0) {
  console.error(`\n✗ ${hintOffences.length} hint(s) repeat the label above them.\n`);
  for (const offence of hintOffences) console.error(`  ${offence}`);
  console.error('\n  A hint carries a unit, a format, a limit or a rule — never the label again.');
  console.error('  See the ui-conventions skill.\n');
  failed = true;
}

if (failed) process.exit(1);
