import { type QueryKey } from '@tanstack/react-query';
import {
  DEFAULT_LANGUAGE,
  type LanguageCode,
  type QuestionLanguage,
  type QuestionType,
} from '@iace/contracts';
import { type AuthoringHeader, type AuthoringState } from './question-scaffold';

/** What the box says. Held as an edit only while it differs from the saved one: that is what "unsaved" means. */
export interface Held {
  header: AuthoringHeader;
  state: AuthoringState;
  /** Whatever a save must still match on the server, carried untouched through every edit. */
  stamp?: string;
}

/** One question's card: where it stands, what may be done to it, and whether it can be typed into. */
export interface WorkspaceCard {
  key: string;
  lead: React.ReactNode;
  actions?: React.ReactNode;
  /** The foot of the editor pane: where the question stands, its clocks, and its notices. */
  status?: React.ReactNode;
  editable: boolean;
}

/** Where the cards come from, and where a saved one goes. */
export interface WorkspaceSource {
  cards: readonly WorkspaceCard[];
  query: (key: string) => { queryKey: QueryKey; queryFn: () => Promise<Held> };
  save: (key: string, held: Held) => Promise<unknown>;
  subjectLocked: boolean;
  /** The kinds a question here may be; absent, any. A section is a typing test or it is not. */
  types?: readonly QuestionType[];
  /** Only where a copy of a bank question refuses the save; an import row just becomes a duplicate. */
  checkDuplicates: boolean;
  /** The languages a question here is sat in, so a section sat in English alone is not asked for Hindi. */
  languages?: readonly LanguageCode[];
  /** A blank card after the last, for writing the next question; absent where nothing new is written. */
  create?: {
    header: AuthoringHeader;
    save: (held: Held) => Promise<unknown>;
    /** After the blank card's own name, in its bar. */
    lead?: React.ReactNode;
  };
  /** Somebody else holds every card: none of them takes an edit until they hand it on. */
  blocked?: boolean;
}

export interface PanelPosition {
  activeKey: string;
  jump: (key: string) => void;
}

/** The progress panel: the trigger opens it over the cards, and it can move them. */
export interface WorkspacePanel {
  label: string;
  render: (position: PanelPosition) => React.ReactNode;
}

/** The key of the blank card a new question is typed into. */
export const NEW_CARD = 'new';

export interface View {
  language: QuestionLanguage;
  /** Bumped when the box must be rebuilt: a language, a type, or an option count changed. */
  box: number;
}

export const FIRST_VIEW: View = { language: DEFAULT_LANGUAGE, box: 0 };

export const BAR =
  'flex min-h-10 flex-none items-center justify-between gap-3 border-b border-border px-4';
