import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keyboard, Maximize2, Minimize2, Save } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  hasText,
  type AuthoringSaveResult,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionLanguage,
} from '@iace/contracts';
import { Button, LoadingState, Tooltip, TooltipContent, TooltipTrigger } from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { usePageTour } from '@iace/app-kit/browser';
import { api } from '../../lib/api';
import { AUTHORING_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { QUERY_KEYS, STORAGE_KEYS, authoringQuestionQueryKey } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { AuthoringHeaderBar } from './authoring-header-bar';
import { Legend, useFocusMode } from './authoring-chrome';
import { QuestionPanes } from './question-panes';
import { useChecked, useDuplicate } from './use-question-checks';
import {
  emptyState,
  headerOf,
  stateFrom,
  SCRIPT_OF,
  stateOf,
  toDraft,
  type AuthoringHeader,
  type AuthoringState,
} from './question-scaffold';

interface Saved {
  header: AuthoringHeader;
  state: AuthoringState;
  language: QuestionLanguage;
  /** The typist's own setting, kept because it is about their keyboard and not this question. */
  romanised: boolean;
}

export function AuthoringEditorPage() {
  const { id } = useParams<{ id?: string }>();
  const { identity } = useAuth();
  const storageKey = `${STORAGE_KEYS.AUTHORING_DRAFT}.${identity?.id ?? ''}`;

  const restored = useMemo(() => restore(storageKey), [storageKey]);
  const [header, setHeader] = useState<AuthoringHeader>(restored.header);
  const [state, setState] = useState<AuthoringState>(restored.state);
  const [language, setLanguage] = useState<QuestionLanguage>(restored.language);
  const [romanised, setRomanised] = useState(restored.romanised);

  // Bumped whenever the box must be rebuilt: a language, a type, or a question loaded into it.
  const [boxVersion, setBoxVersion] = useState(0);
  const rebuildBox = useCallback(() => setBoxVersion((version) => version + 1), []);

  const focus = useFocusMode();

  const editingId = id ?? '';
  usePageTour({ id: TOUR_IDS.AUTHORING, steps: AUTHORING_TOUR, ready: true });
  const editing = useQuery({
    queryKey: authoringQuestionQueryKey(id),
    queryFn: () => api.admin.authoring.detail(editingId),
    enabled: editingId !== '',
  });

  useFilledOnce(editing.data, (question) => {
    setHeader(headerOf(question));
    setState(stateOf(question));
    setLanguage(DEFAULT_LANGUAGE);
    rebuildBox();
  });

  const saved = useMemo(
    () => ({ header, state, language, romanised }),
    [header, state, language, romanised],
  );
  usePersistedDraft(storageKey, editingId === '', saved);

  const draft = useMemo(() => toDraft(state, header), [state, header]);
  const duplicate = useDuplicate(draft, editingId);
  const { issues, checks } = useChecked(draft, header, state, duplicate);

  const save = useSaveQuestion(editingId, draft, () => {
    if (editingId) return;
    // The header survives: the next fifty questions are the same subject at the same level.
    setState(emptyState(state.type));
    rebuildBox();
  });

  const canSave = issues.length === 0 && duplicate === null && !save.isPending;

  const cycleLanguage = useCallback(() => {
    setLanguage((current) => {
      const at = LANGUAGE_ORDER.indexOf(current);
      return LANGUAGE_ORDER[(at + 1) % LANGUAGE_ORDER.length] ?? current;
    });
    rebuildBox();
  }, [rebuildBox]);

  const switchLanguage = useCallback(
    (next: QuestionLanguage) => {
      setLanguage(next);
      rebuildBox();
    },
    [rebuildBox],
  );

  const onRegions = useCallback(
    (regions: ScaffoldRegion[]) => setState((current) => stateFrom(current, language, regions)),
    [language],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AuthoringHeaderBar
        header={header}
        state={state}
        subjectLocked={false}
        onHeaderChange={setHeader}
        onStateChange={(next) => {
          setState(next);
          rebuildBox();
        }}
        actions={
          <EditorActions
            language={language}
            romanised={romanised}
            immersive={focus.immersive}
            onRomanised={() => setRomanised((on) => !on)}
            onFocus={focus.toggle}
          />
        }
      />

      <div data-tour={TOUR_TARGETS.AUTHORING_CARD} className="flex min-h-0 flex-1 bg-muted/40 p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {editing.isPending && editingId !== '' ? (
            <LoadingState>Loading the question</LoadingState>
          ) : (
            <QuestionPanes
              questionId={editingId}
              state={state}
              language={language}
              romanised={romanised}
              canSave={canSave}
              boxVersion={boxVersion}
              checks={checks}
              onRegions={onRegions}
              onCycleLanguage={cycleLanguage}
              onLanguageChange={switchLanguage}
              onSave={() => save.mutate()}
            />
          )}
        </div>
      </div>

      <Legend
        actions={
          <Button type="button" size="sm" disabled={!canSave} onClick={() => save.mutate()}>
            <Save aria-hidden />
            {id ? 'Save' : 'Save and next'}
          </Button>
        }
      />
    </div>
  );
}

/** The header's right-hand end. Its own component, so the page reads as a page. */
function EditorActions({
  language,
  romanised,
  immersive,
  onRomanised,
  onFocus,
}: Readonly<{
  language: QuestionLanguage;
  romanised: boolean;
  immersive: boolean;
  onRomanised: () => void;
  onFocus: () => void;
}>) {
  return (
    <>
      {SCRIPT_OF[language] ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={romanised ? 'default' : 'ghost'}
              size="icon"
              aria-pressed={romanised}
              aria-label="Type in Roman letters"
              onClick={onRomanised}
            >
              <Keyboard aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {romanised
              ? `Typing dhanyavaad writes it in ${LANGUAGE_LABELS[language]}`
              : 'Roman letters stay as they are typed'}
          </TooltipContent>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={immersive ? 'Leave full screen' : 'Full screen'}
            onClick={onFocus}
          >
            {immersive ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{immersive ? 'Leave full screen' : 'Full screen'}</TooltipContent>
      </Tooltip>
    </>
  );
}

/** Saving is all the server hears: a new question, or the draft this editor was opened on. */
function useSaveQuestion(
  questionId: string,
  draft: QuestionDraft,
  onSaved: (result: AuthoringSaveResult) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { success: questionId ? 'Question saved.' : 'Question saved. Next one.' },
    mutationFn: () =>
      questionId
        ? api.admin.authoring.update(questionId, draft)
        : api.admin.authoring.create(draft),
    onSuccess: async (result) => {
      onSaved(result);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
    },
  });
}

/** The fetched question fills the boxes once; a refetch must not overwrite what is being typed. */
function useFilledOnce(
  question: QuestionDetail | undefined,
  fill: (question: QuestionDetail) => void,
) {
  const [filledId, setFilledId] = useState<string | null>(null);
  if (question && filledId !== question.id) {
    setFilledId(question.id);
    fill(question);
  }
}

/** A closed tab loses nothing, and nothing half-written reaches the bank: only a save writes a row. */
function usePersistedDraft(key: string, enabled: boolean, saved: Saved) {
  useEffect(() => {
    if (!enabled) return;
    window.localStorage.setItem(key, JSON.stringify(saved));
  }, [key, enabled, saved]);
}

/** What a reopened tab starts from: the draft it left, over the blanks a first visit gets. */
function restore(key: string): Saved {
  const blank: Saved = {
    header: { subjectId: '', topicId: '', difficulty: DIFFICULTY_LEVEL.MEDIUM, tags: '' },
    state: emptyState(),
    language: DEFAULT_LANGUAGE,
    romanised: true,
  };

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return blank;
    const kept = { ...blank, ...(JSON.parse(raw) as Partial<Saved>) };
    // Only an unfinished question earns its settings back; an empty box is a first visit.
    return wasTyped(kept.state) ? kept : { ...blank, romanised: kept.romanised };
  } catch {
    return blank;
  }
}

/** Anything the typist put in the box, in any language, including the answer line. */
function wasTyped(state: AuthoringState): boolean {
  if (state.answer.trim() !== '') return true;
  return LANGUAGE_ORDER.some((code) => {
    const content = state.content[code];
    return hasText(content.stem) || hasText(content.solution) || content.options.some(hasText);
  });
}
