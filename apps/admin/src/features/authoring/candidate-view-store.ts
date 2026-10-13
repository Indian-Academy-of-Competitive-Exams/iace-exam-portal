import { type QuestionLanguage } from '@iace/contracts';
import { ROUTES, STORAGE_KEYS } from '../../lib/constants';
import { type AuthoringState } from './question-scaffold';

/** The question as typed, handed to the tab that shows it; its text never rides the address. */
export interface CandidateView {
  state: AuthoringState;
  language: QuestionLanguage;
}

const PREFIX = `${STORAGE_KEYS.CANDIDATE_VIEW}.`;

export function openCandidateView(view: CandidateView): void {
  const storage = window.localStorage;
  // Only the newest view is kept: an older tab already read its own and loses it on a reload.
  for (const key of Object.keys(storage)) {
    if (key.startsWith(PREFIX)) storage.removeItem(key);
  }
  const id = crypto.randomUUID();
  storage.setItem(PREFIX + id, JSON.stringify(view));
  window.open(ROUTES.CANDIDATE_VIEW(id), '_blank', 'noopener');
}

export function readCandidateView(id: string): CandidateView | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as CandidateView) : null;
  } catch {
    return null;
  }
}
