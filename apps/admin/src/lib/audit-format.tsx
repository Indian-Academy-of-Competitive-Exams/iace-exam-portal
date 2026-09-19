import { Link } from 'react-router-dom';
import { LANGUAGE_LABELS, type QuestionLanguage, type RowAction } from '@iace/contracts';
import { Badge, BadgeList, linkVariants, TruncatedText } from '@iace/ui';
import { ROUTES } from './constants';

/** One rendering of a `RowAction`, shared by every screen that shows one. */

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/** What a question SAYS is logged leaf by leaf (`stem.EN`, `option.3.HI`), so name the leaf. */
const CONTENT_FIELD_NOUNS: Readonly<Record<string, string>> = {
  stem: 'Stem',
  solution: 'Solution',
  option: 'Option',
};

/** Anything else — a column, a key from another feature — reads as the field name it already is. */
function fieldLabel(field: string): string {
  const parts = field.split('.');
  const noun = CONTENT_FIELD_NOUNS[parts[0] ?? ''];
  const language = LANGUAGE_LABELS[(parts.at(-1) ?? '').toLowerCase() as QuestionLanguage];
  if (!noun || !language) return field;

  const position = parts.length === 3 ? ` ${parts[1]}` : '';
  return `${noun}${position} (${language})`;
}

function diffLabel(field: string, diff: { from: unknown; to: unknown }): string {
  return `${fieldLabel(field)}: ${formatDiffValue(diff.from)} → ${formatDiffValue(diff.to)}`;
}

/**
 * An import-sourced row carries no diff — `recordImportRows` writes one thin entry per touched
 * entity, by design — so it links to Import runs, where that run's status and counts live.
 */
export function ChangedCell({ row }: Readonly<{ row: RowAction }>) {
  if (row.changed) {
    const entries = Object.entries(row.changed);
    return (
      <BadgeList
        items={entries}
        label={([field, diff]) => diffLabel(field, diff)}
        max={2}
        className="max-w-[22rem]"
      >
        {([field, diff]) => (
          <Badge className="min-w-0 shrink">
            <TruncatedText>{diffLabel(field, diff)}</TruncatedText>
          </Badge>
        )}
      </BadgeList>
    );
  }

  if (row.importLogId) {
    return (
      <Link to={`${ROUTES.AUDIT_IMPORTS}?run=${row.importLogId}`} className={linkVariants()}>
        From an import. View run
      </Link>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}
