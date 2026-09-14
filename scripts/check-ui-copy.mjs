/**
 * The half of the no-self-explaining rule types cannot reach: a hint that repeats its label.
 * Descriptions need no check — PageHeader and FormSection have no such prop, so prose there
 * is a type error as you write it. Only the lines a commit ADDS are judged.
 */
import { stagedSources } from './staged.mjs';

const CHECKED = /\.tsx$/;

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

const offences = [];

for (const { file, source, added } of stagedSources(CHECKED)) {
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
