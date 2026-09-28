import { useEffect, useMemo, useState } from 'react';
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
import { QUERY_KEYS } from '../../lib/constants';
import { checksFor } from './authoring-checks';
import { taxonomyFor, type AuthoringHeader, type AuthoringState } from './question-scaffold';

const PREVIEW_DEBOUNCE_MS = 600;

/** Longer than the preview's: this one leaves the machine, and a half-typed stem matches nothing. */
const DUPLICATE_DEBOUNCE_MS = 900;

/** Asked of the draft on screen, not of the row a save would otherwise have left behind. */
export function useDuplicate(draft: QuestionDraft | null, editingId: string): string | null {
  const [asked, setAsked] = useState<QuestionDraft | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setAsked(draft), DUPLICATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const found = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, 'duplicate', asked, editingId],
    queryFn: () => api.admin.authoring.duplicate(asked as QuestionDraft, editingId || undefined),
    enabled: asked !== null && hasText(asked.stem[DEFAULT_LANGUAGE] ?? ''),
  });

  return found.data?.duplicateOf?.stemPreview ?? null;
}

/** The rules the save and the sheet are judged by, debounced so the panel settles as you type. */
export function useChecked(
  draft: QuestionDraft,
  header: AuthoringHeader,
  state: AuthoringState,
  duplicate: string | null,
) {
  const [issues, setIssues] = useState<ReturnType<typeof validateQuestion>>([]);

  useEffect(() => {
    const timer = setTimeout(
      () => setIssues(validateQuestion(draft, taxonomyFor(header), mathErrorIn)),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [draft, header]);

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
