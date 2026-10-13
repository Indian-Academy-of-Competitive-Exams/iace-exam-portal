import { type QuestionLanguage } from '@iace/contracts';
import { ROUTES, STORAGE_KEYS } from '../../lib/constants';
import { type AuthoringState } from './question-scaffold';

/** The question as typed, handed to the tab that shows it; its text never rides the address. */
export interface CandidateView {
  state: AuthoringState;
  language: QuestionLanguage;
}

const PREFIX = `${STORAGE_KEYS.CANDIDATE_VIEW}.`;

/** Answers false when the browser would not hold the view, so the caller can say so. */
export function openCandidateView(view: CandidateView): boolean {
  const storage = window.localStorage;
  const id = crypto.randomUUID();
  try {
    // Only the newest view is kept: an older tab already read its own and loses it on a reload.
    for (const key of Object.keys(storage)) {
      if (key.startsWith(PREFIX)) storage.removeItem(key);
    }
    storage.setItem(PREFIX + id, JSON.stringify(view));
  } catch {
    return false;
  }
  window.open(ROUTES.CANDIDATE_VIEW(id), '_blank', 'noopener');
  return true;
}

/** Null for a view that is absent or not shaped like one: a stored string is not to be trusted to be a question. */
export function readCandidateView(id: string): CandidateView | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + id);
    const view = raw ? (JSON.parse(raw) as Partial<CandidateView>) : null;
    return view?.state?.content && view.language ? (view as CandidateView) : null;
  } catch {
    return null;
  }
}
