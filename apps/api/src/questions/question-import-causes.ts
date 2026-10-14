import {
  QUESTION_VALIDATION_CODE,
  IMPORT_FIX_KINDS,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  canonicalName,
  type ImportFix,
  type ImportFixKind,
  type QuestionImportPlan,
  type ValidationIssue,
} from '@iace/contracts';
import { type CsvRow } from '../common/importing';
import { lookupName, type TaxonomyCatalog } from './taxonomy-context';
import { blank, cellOf } from './question-import-cells';
import type { PlannedRow } from './question-import';

const CODE = QUESTION_VALIDATION_CODE;

/** A subject, topic or difficulty the sheet names that the bank does not hold. */
export type MissingValue = Omit<ImportFix, 'suggestions'>;

const MISSING_CODES: Readonly<Record<ImportFixKind, readonly string[]>> = {
  [IMPORT_FIX_KINDS.SUBJECT]: [CODE.SUBJECT_UNKNOWN],
  [IMPORT_FIX_KINDS.TOPIC]: [CODE.TOPIC_UNKNOWN, CODE.TOPIC_NOT_IN_SUBJECT],
  [IMPORT_FIX_KINDS.DIFFICULTY]: [CODE.DIFFICULTY_INVALID],
};

type Cause = NonNullable<QuestionImportPlan['causes']>[number];

/** Each reason held against more than one row, or naming a value that can be fixed, once with its count; most first. */
export function causesOf(rows: readonly PlannedRow[], catalog: TaxonomyCatalog): Cause[] {
  const causes = new Map<string, Cause>();
  for (const row of rows) {
    if (row.action !== 'skip') continue;
    const said = new Set<string>();
    for (const issue of row.issues) {
      const missing = missingBehind(row, issue);
      const key = missing ? missingKey(missing) : issue.message;
      if (said.has(key)) continue;
      said.add(key);
      const held = causes.get(key);
      if (held) held.count += 1;
      else causes.set(key, newCause(issue, missing, catalog));
    }
  }
  return [...causes.values()]
    .filter((cause) => cause.count > 1 || cause.fix)
    .sort((a, b) => b.count - a.count);
}

function missingBehind(row: PlannedRow, issue: ValidationIssue): MissingValue | null {
  return row.missing && MISSING_CODES[row.missing.kind].includes(issue.code) ? row.missing : null;
}

/** A missing value is one cause however the sheet cased it: one choice fixes every spelling. */
const missingKey = (missing: MissingValue): string =>
  [missing.kind, missing.subjectId ?? '', lookupName(missing.value)].join('|');

function newCause(
  issue: ValidationIssue,
  missing: MissingValue | null,
  catalog: TaxonomyCatalog,
): Cause {
  if (!missing) return { message: issue.message, count: 1 };
  return {
    message: issue.message,
    count: 1,
    fix: { ...missing, suggestions: suggestionsFor(missing, catalog) },
  };
}

/** The bank's own values closest to the one the sheet names, by the words they share; best three. */
function suggestionsFor(missing: MissingValue, catalog: TaxonomyCatalog): ImportFix['suggestions'] {
  if (missing.kind === IMPORT_FIX_KINDS.DIFFICULTY) {
    return DIFFICULTY_LEVELS.map((level) => ({ value: level, label: DIFFICULTY_LABELS[level] }));
  }
  const choices =
    missing.kind === IMPORT_FIX_KINDS.SUBJECT
      ? catalog.subjects.map((subject) => ({ value: subject.id, label: subject.name }))
      : (catalog.subjects
          .find((subject) => subject.id === missing.subjectId)
          ?.topics.map((topic) => ({ value: topic.id, label: topic.name })) ?? []);
  const wanted = new Set(wordsOf(missing.value));
  return choices
    .map((choice) => ({
      choice,
      shared: wordsOf(choice.label).filter((word) => wanted.has(word)).length,
    }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || a.choice.label.localeCompare(b.choice.label))
    .slice(0, SUGGESTIONS_MAX)
    .map(({ choice }) => choice);
}

const SUGGESTIONS_MAX = 3;

/** Words worth matching on: "AND", "OF" and "THE" would pair every long name with every other. */
const FILLER_WORDS: ReadonlySet<string> = new Set(['AND', 'OF', 'THE', 'IN', 'FOR']);

const wordsOf = (value: string): string[] =>
  canonicalName(value)
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 1 && !FILLER_WORDS.has(word));

/** What keeps a row out when it is a value the bank does not hold, read off the sheet as written. */
export function missingOf(
  row: CsvRow,
  edited: boolean,
  names: { subject: string; topic: string },
  subjectId: string,
  issues: readonly ValidationIssue[],
): MissingValue | null {
  if (edited) return null;
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has(CODE.SUBJECT_UNKNOWN))
    return { kind: IMPORT_FIX_KINDS.SUBJECT, value: names.subject };
  if (codes.has(CODE.TOPIC_UNKNOWN) || codes.has(CODE.TOPIC_NOT_IN_SUBJECT)) {
    return { kind: IMPORT_FIX_KINDS.TOPIC, value: names.topic, subjectId };
  }
  const difficulty = cellOf(row, 'difficulty');
  if (codes.has(CODE.DIFFICULTY_INVALID) && !blank(difficulty)) {
    return { kind: IMPORT_FIX_KINDS.DIFFICULTY, value: difficulty };
  }
  return null;
}
