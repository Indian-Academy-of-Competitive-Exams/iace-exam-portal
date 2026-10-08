import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keyboard, Maximize2, Minimize2, Save } from 'lucide-react';
import {
  AppException,
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  FEATURE_KEYS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  PERMISSION_LEVELS,
  hasText,
  type QuestionDetail,
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
import { Legend, QuestionNotLoaded, useFocusMode } from './authoring-chrome';
import { QuestionPanes } from './question-panes';
import { useUnsavedPrompt } from './use-unsaved-prompt';
import { issuesOf, useChecked, useDuplicate } from './use-question-checks';
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

/** What a save sends, and what the box then holds with nothing unsaved in it. */
type Sent = Pick<Saved, 'header' | 'state'>;

/** A fresh editor for each address: one question's text never shows, or saves, under another's. */
export function AuthoringEditorPage() {
  const { id } = useParams<{ id?: string }>();
  return <Editor key={id ?? ''} id={id} />;
}

function Editor({ id }: Readonly<{ id: string | undefined }>) {
  const { identity, can } = useAuth();
  // Below WRITE the question is its author's to read, and the box takes nothing.
  const canWrite = can(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE);
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

  // A saved question as last read or saved; a new one is kept in the browser instead, so it has none.
  const [clean, setClean] = useState<string | null>(null);
  // The stamp of that read or save, not of a later re-read: the box still holds what came with it.
  const [stamp, setStamp] = useState<string>();
  useFilledOnce(editing.data, (question) => {
    const read: Sent = { header: headerOf(question), state: stateOf(question) };
    setHeader(read.header);
    setState(read.state);
    setClean(JSON.stringify(read));
    setStamp(question.updatedAt);
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

  const save = useSaveQuestion(editingId, stamp, (sent, question) => {
    if (editingId) {
      setStamp(question.updatedAt);
      return setClean(JSON.stringify(sent));
    }
    // The header survives: the next fifty questions are the same subject at the same level.
    setState(emptyState(sent.state.type));
    rebuildBox();
  });
  const unsaved = useMemo(
    () => clean !== null && JSON.stringify({ header, state } satisfies Sent) !== clean,
    [clean, header, state],
  );
  useUnsavedPrompt(unsaved);

  // A question that was not read leaves the box blank on its id, and a save from there would overwrite it.
  const loaded = editingId === '' || editing.data !== undefined;
  const typing = canWrite && loaded;
  const canSave = typing && issues.length === 0 && duplicate === null && !save.isPending;
  const saveNow = () => {
    // The button reads issues that lag the last keystroke, so the save judges what it is about to send.
    if (issuesOf(draft, header).length === 0) save.mutate({ header, state });
  };

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
        disabled={!typing}
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
          {loaded ? (
            <QuestionPanes
              questionId={editingId}
              state={state}
              language={language}
              romanised={romanised}
              canSave={canSave}
              readOnly={!canWrite}
              boxVersion={boxVersion}
              checks={checks}
              onRegions={onRegions}
              onCycleLanguage={cycleLanguage}
              onLanguageChange={switchLanguage}
              onSave={saveNow}
            />
          ) : (
            <Unread error={editing.error} onRetry={() => void editing.refetch()} />
          )}
        </div>
      </div>

      <Legend
        actions={
          typing ? (
            <Button type="button" size="sm" disabled={!canSave} onClick={saveNow}>
              <Save aria-hidden />
              {id ? 'Save' : 'Save and next'}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** In the box's place until its question is read: still loading, or the reason it did not come. */
function Unread({ error, onRetry }: Readonly<{ error: unknown; onRetry: () => void }>) {
  if (error === null) return <LoadingState>Loading the question</LoadingState>;
  return <QuestionNotLoaded error={error} onRetry={onRetry} />;
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
  stamp: string | undefined,
  onSaved: (sent: Sent, question: QuestionDetail) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { success: questionId ? 'Question saved.' : 'Question saved. Next one.' },
    mutationFn: ({ header, state }: Sent) => {
      const draft = toDraft(state, header);
      // An edit carries the stamp it was read on: built on an older read it is refused, not written over a newer one.
      return questionId
        ? api.admin.authoring.update(questionId, { ...draft, expectedUpdatedAt: stamp })
        : api.admin.authoring.create(draft);
    },
    onSuccess: async ({ question }, sent) => {
      onSaved(sent, question);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
    },
    onError: (error) => {
      // Read again, so reopening the editor starts from what is saved and not the copy just refused.
      if (questionId && AppException.is(error) && error.code === ErrorCodes.CONFLICT) {
        void queryClient.invalidateQueries({ queryKey: authoringQuestionQueryKey(questionId) });
      }
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
