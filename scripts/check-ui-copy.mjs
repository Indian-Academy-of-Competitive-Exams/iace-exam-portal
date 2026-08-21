/**
 * The half of the no-self-explaining rule types cannot reach: a hint that repeats its label.
 * Descriptions need no check — PageHeader and FormSection have no such prop, so prose there
 * is a type error as you write it. Only the lines a commit ADDS are judged.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHECKED = /\.tsx$/;
const SKIPPED = /(^|\/)(dist|node_modules|coverage)\//;

/** Words too common to prove a hint is echoing its label. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'this',
  'that',
  'your',
  'you',
  'is',
  'are',
  'it',
  'its',
  'of',
  'to',
  'for',
  'in',
  'on',
  'with',
  'be',
  'will',
  'enter',
  'choose',
  'pick',
  'select',
  'type',
]);

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The 1-indexed line numbers this commit adds to a file, from the staged hunk headers. */
function addedLines(file) {
  const added = new Set();
  const diff = git('diff', '--cached', '-U0', '--', file);
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/.exec(line);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let i = 0; i < count; i += 1) added.add(start + i);
  }
  return added;
}

const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );

const offences = [];

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACM')
  .split('\n')
  .map((file) => file.trim())
  .filter((file) => file && CHECKED.test(file) && !SKIPPED.test(file));

for (const file of staged) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const added = addedLines(file);
  if (added.size === 0) continue;
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
      offences.push(`${file}:${index + 1}  hint "${hint[1]}" only repeats label "${label[1]}"`);
    }
  });
}

if (offences.length > 0) {
  console.error(`\n✗ ${offences.length} hint(s) repeat the label above them.\n`);
  for (const offence of offences) console.error(`  ${offence}`);
  console.error('\n  A hint carries a unit, a format, a limit or a rule — never the label again.');
  console.error('  See the ui-conventions skill.\n');
  process.exit(1);
}
