/**
 * Docs rot silently: a table is renamed, the prose keeps the old name, and no gate notices.
 * Check A — a backticked multi-word name in a doc must be a Prisma model/enum or a TS symbol.
 * Check B — a `docs/03 §N` citation must land on a heading that exists. Build output, tests and
 * comments are NOT source: each makes a dead name read as alive, which is the drift being caught.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TABLE_LIKE = /^[A-Z][a-z]+[A-Z]/;
const NOT_SOURCE = /(^|\/)(dist|node_modules|coverage|build)\//;
/** A package's test/ directory, not the package NAMED test — apps/test is the student SPA. */
const NOT_SOURCE_TEST = /(?:^(?:apps|packages)\/[^/]+\/test\/)|(?:\.test\.tsx?$)/;
const SOURCE_FILE = /\.tsx?$/;
const DOC_EXTENSION = '.md';

/** Prose in a comment names things it does not define — `AccessResolver` outlived the class. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** Node built-in, so it is real without being ours; every entry here needs a reason. */
const ALLOWED = new Set(['EventEmitter']);

const SCHEMA_PATH = 'prisma/schema.prisma';
const ARCHITECTURE_DOC = 'docs/03-conventions.md';
const ROOT_DOCS = ['CLAUDE.md', 'README.md'];

const PRISMA_MODEL = /^(?:model|enum) (\w+) \{/gm;
const SOURCE_SYMBOL = /\b([A-Z][A-Za-z0-9]*)\b/g;
const DOC_IDENTIFIER = /`([A-Z][A-Za-z0-9]*)[`.]/g;
const SECTION_HEADING = /^## (\d+)\./gm;
const SUBSECTION_HEADING = /^### (\d+\.\d+)/gm;
const NUMBERED_RULE = /^(\d+)\. /gm;
const SECTION_CITATION = /docs\/03 §(\d+(?:\.\d+)?)/g;

const captured = (text, pattern) => [...text.matchAll(pattern)].map(([, capture]) => capture);
const alphabetical = (a, b) => a.localeCompare(b);

const codeOnly = (text) =>
  text
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');

/** One entry per thing named, carrying every file that named it — never one per occurrence. */
function groupPaths(pairs) {
  const groups = new Map();
  for (const [key, path] of pairs) groups.set(key, (groups.get(key) ?? new Set()).add(path));
  return [...groups]
    .sort(([a], [b]) => alphabetical(a, b))
    .map(([key, paths]) => [key, [...paths].sort(alphabetical)]);
}

/** Build output and tests describe code rather than being it — a DROP TABLE is not a table. */
export const isLiveCode = (path) => !NOT_SOURCE.test(path) && !NOT_SOURCE_TEST.test(path);

const isSourceFile = (path) => SOURCE_FILE.test(path) && isLiveCode(path);

export function sourceSymbols(files) {
  const symbols = new Set();
  for (const { path, text } of files) {
    if (!isSourceFile(path)) continue;
    for (const symbol of captured(codeOnly(text), SOURCE_SYMBOL)) symbols.add(symbol);
  }
  return symbols;
}

export function ghostIdentifiers({ docs, models, symbols, allowlist }) {
  const live = new Set([...models, ...symbols, ...allowlist]);
  const cited = docs.flatMap(({ path, text }) =>
    captured(text, DOC_IDENTIFIER)
      .filter((name) => TABLE_LIKE.test(name) && !live.has(name))
      .map((name) => [name, path]),
  );
  return groupPaths(cited).map(([name, paths]) => ({ name, paths }));
}

export function brokenSectionRefs({ headings, citations }) {
  const known = new Set(headings);
  const unresolved = citations
    .filter(({ section }) => !known.has(section))
    .map(({ section, path }) => [section, path]);
  return groupPaths(unresolved).map(([section, paths]) => ({ section, paths }));
}

/** docs/03 numbers its rules as list items, so §4.1 is rule 1 of section 4 and has no heading. */
export function architectureHeadings(doc) {
  const headings = new Set(captured(doc, SUBSECTION_HEADING));
  const sections = [...doc.matchAll(SECTION_HEADING)];
  sections.forEach(({ 1: number, index }, position) => {
    headings.add(number);
    const body = doc.slice(index, sections[position + 1]?.index);
    for (const rule of captured(body, NUMBERED_RULE)) headings.add(`${number}.${rule}`);
  });
  return [...headings];
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const tracked = (...pathspecs) =>
  git('ls-files', '-z', ...pathspecs)
    .split('\0')
    .filter(Boolean);

const load = (paths) => paths.map((path) => ({ path, text: readFileSync(path, 'utf8') }));

function report(headline, lines, trailer) {
  console.error(`\n✗ ${headline}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(`\n  ${trailer.join('\n  ')}\n`);
}

function main() {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const models = new Set(captured(schema, PRISMA_MODEL));
  const symbols = sourceSymbols(load(tracked('*.ts', '*.tsx')));
  const docs = load(tracked('docs', ...ROOT_DOCS).filter((path) => path.endsWith(DOC_EXTENSION)));

  const headings = architectureHeadings(readFileSync(ARCHITECTURE_DOC, 'utf8'));
  const citing = tracked('*.ts', '*.tsx', '.husky', '*.mjs').filter(isLiveCode);
  const citations = load(citing).flatMap(({ path, text }) =>
    captured(text, SECTION_CITATION).map((section) => ({ path, section })),
  );

  const ghosts = ghostIdentifiers({ docs, models, symbols, allowlist: ALLOWED });
  const broken = brokenSectionRefs({ headings, citations });

  if (ghosts.length > 0) {
    report(
      `${ghosts.length} name(s) the docs use that the repo does not have.`,
      ghosts.map(({ name, paths }) => `${name}  cited in ${paths.join(', ')}`),
      [
        `A doc may only name what ${SCHEMA_PATH} or the TypeScript source defines.`,
        'Rename the prose, not the code.',
      ],
    );
  }

  if (broken.length > 0) {
    report(
      `${broken.length} section(s) cited by code that ${ARCHITECTURE_DOC} does not have.`,
      broken.map(({ section, paths }) => `§${section}  cited by ${paths.join(', ')}`),
      [
        'Renumbering a section is what breaks this, and the code is what went stale.',
        'Repoint the citation, or put the heading back.',
      ],
    );
  }

  if (ghosts.length + broken.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
