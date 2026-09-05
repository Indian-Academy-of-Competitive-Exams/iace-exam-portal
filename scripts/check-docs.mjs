/**
 * Docs rot silently: a table is renamed, the prose keeps the old name, and no gate notices.
 * Check A — a backticked multi-word name in a doc must be a Prisma model/enum or a TS symbol.
 * Check B — a `docs/03 §N` citation must land on a heading that exists. Build output and tests
 * are NOT source: a stale dist/ and a `DROP TABLE "X"` both make a dead name read as alive.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TABLE_LIKE = /^[A-Z][a-z]+[A-Z]/;
const NOT_SOURCE = /(^|\/)(dist|node_modules|coverage|build)\//;
const NOT_SOURCE_TEST = /(?:(?:^|\/)test\/)|(?:\.test\.tsx?$)/;
const SOURCE_FILE = /\.tsx?$/;
const DOC_EXTENSION = '.md';

/** Node built-in, so it is real without being ours; every entry here needs a reason. */
const ALLOWED = new Set(['EventEmitter']);

const SCHEMA_PATH = 'prisma/schema.prisma';
const ARCHITECTURE_DOC = 'docs/03-shared-architecture.md';
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

/** Build output and tests describe code rather than being it — a DROP TABLE is not a table. */
export const isLiveCode = (path) => !NOT_SOURCE.test(path) && !NOT_SOURCE_TEST.test(path);

const isSourceFile = (path) => SOURCE_FILE.test(path) && isLiveCode(path);

export function sourceSymbols(files) {
  const symbols = new Set();
  for (const { path, text } of files) {
    if (!isSourceFile(path)) continue;
    for (const symbol of captured(text, SOURCE_SYMBOL)) symbols.add(symbol);
  }
  return symbols;
}

export function ghostIdentifiers({ docs, models, symbols, allowlist }) {
  const live = new Set([...models, ...symbols, ...allowlist]);
  const ghosts = new Map();
  for (const { path, text } of docs) {
    for (const name of captured(text, DOC_IDENTIFIER)) {
      if (!TABLE_LIKE.test(name) || live.has(name)) continue;
      ghosts.set(name, (ghosts.get(name) ?? new Set()).add(path));
    }
  }
  return [...ghosts]
    .map(([name, paths]) => `${name}  cited in ${[...paths].sort(alphabetical).join(', ')}`)
    .sort(alphabetical);
}

export function brokenSectionRefs({ headings, citations }) {
  const known = new Set(headings);
  return citations
    .filter(({ section }) => !known.has(section))
    .map(({ path, section }) => `docs/03 §${section}  cited in ${path}`)
    .sort(alphabetical);
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

function main() {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const models = new Set(captured(schema, PRISMA_MODEL));
  const symbols = sourceSymbols(load(tracked('*.ts', '*.tsx')));
  const docs = load([
    ...tracked('docs').filter((path) => path.endsWith(DOC_EXTENSION)),
    ...ROOT_DOCS,
  ]);

  const headings = architectureHeadings(readFileSync(ARCHITECTURE_DOC, 'utf8'));
  const citing = tracked('*.ts', '*.tsx', '.husky', '*.mjs').filter(isLiveCode);
  const citations = load(citing).flatMap(({ path, text }) =>
    captured(text, SECTION_CITATION).map((section) => ({ path, section })),
  );

  const offences = [
    ...ghostIdentifiers({ docs, models, symbols, allowlist: ALLOWED }),
    ...brokenSectionRefs({ headings, citations }),
  ];

  if (offences.length === 0) return;

  console.error(`\n✗ ${offences.length} name(s) the docs use that the repo does not have.\n`);
  for (const offence of offences) console.error(`  ${offence}`);
  console.error('\n  A doc may only name what prisma/schema.prisma, the TypeScript source or');
  console.error(`  ${ARCHITECTURE_DOC} actually defines. Rename the prose, not the code.\n`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
