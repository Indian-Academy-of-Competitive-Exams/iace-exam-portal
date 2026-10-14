import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  hasText,
  validateQuestion,
  type QuestionDraft,
} from '@iace/contracts';
import { mathErrorIn } from '@iace/ui';
import { api } from '../../lib/api';
import { authoringDuplicateQueryKey } from '../../lib/constants';
import { checksFor } from './authoring-checks';
import { taxonomyFor, type AuthoringHeader, type AuthoringState } from './question-scaffold';

const PREVIEW_DEBOUNCE_MS = 600;

/** Longer than the preview's: this one leaves the machine, and a half-typed stem matches nothing. */
const DUPLICATE_DEBOUNCE_MS = 900;

interface Asked {
  draft: QuestionDraft;
  editingId: string;
  revision: number;
}

/** Asked of the draft on screen, not of the row a save would otherwise have left behind. */
export function useDuplicate(draft: QuestionDraft | null, editingId: string): string | null {
  // The card travels with its draft, so a debounce straddling a card switch asks nothing of the new one.
  const [asked, setAsked] = useState<Asked | null>(null);
  // Only ever forward, so no two drafts share a key; the draft itself is too big to hash every render.
  const revision = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      revision.current += 1;
      setAsked(draft ? { draft, editingId, revision: revision.current } : null);
    }, DUPLICATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, editingId]);

  const current = asked?.editingId === editingId ? asked : null;
  const found = useQuery({
    queryKey: authoringDuplicateQueryKey(editingId, current?.revision),
    queryFn: () =>
      api.admin.authoring.duplicate(current?.draft as QuestionDraft, editingId || undefined),
    enabled: current !== null && hasText(current.draft.stem[DEFAULT_LANGUAGE] ?? ''),
    // Advisory, and asked again on every pause: the save is what refuses a copy, so a failed ask says nothing.
    meta: { silent: true },
    retry: false,
  });

  return current ? (found.data?.duplicateOf?.stemPreview ?? null) : null;
}

/** The rules as they stand this instant, for a save that cannot wait on the debounce. */
export const issuesOf = (draft: QuestionDraft | null, header: AuthoringHeader | undefined) =>
  draft && header ? validateQuestion(draft, taxonomyFor(header), mathErrorIn) : [];

/** Judged once at first sight, then debounced: a strict KaTeX render of every formula is not a per-keystroke cost. */
export function useIssues(draft: QuestionDraft | null, header: AuthoringHeader | undefined) {
  const [issues, setIssues] = useState(() => issuesOf(draft, header));

  useEffect(() => {
    const timer = setTimeout(() => setIssues(issuesOf(draft, header)), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, header]);

  return issues;
}

/** The rules the save and the sheet are judged by, debounced so the panel settles as you type. */
export function useChecked(
  draft: QuestionDraft,
  header: AuthoringHeader,
  state: AuthoringState,
  duplicate: string | null,
) {
  const issues = useIssues(draft, header);

  const checks = useMemo(() => {
    const missing = LANGUAGE_ORDER.filter(
      (code) => code !== DEFAULT_LANGUAGE && !hasText(state.content[code].stem),
    );
    return checksFor(
      state,
      issues,
      missing.map((code) => LANGUAGE_LABELS[code]),
      duplicate,
    );
  }, [state, issues, duplicate]);

  return { issues, checks };
}
