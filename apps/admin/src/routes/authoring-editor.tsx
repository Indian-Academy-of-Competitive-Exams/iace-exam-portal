import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Maximize2, Minimize2, Save } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
  QUESTION_STATUS,
  QUESTION_TYPE,
  hasText,
  validateQuestion,
  type QuestionDraft,
  type QuestionLanguage,
} from '@iace/contracts';
import { useFullscreen, useWorkspace } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  Kbd,
  LoadingState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  mathErrorIn,
} from '@iace/ui';
import { ScaffoldEditor, type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { api } from '../lib/api';
import { QUERY_KEYS, STORAGE_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { AuthoringHeaderBar } from '../components/authoring/authoring-header-bar';
import {
  AuthoringChecks,
  AuthoringPreview,
  checksFor,
} from '../components/authoring/authoring-preview';
import {
  OPTION_REPEAT,
  emptyState,
  headerOf,
  regionsFor,
  stateFrom,
  stateOf,
  taxonomyFor,
  toDraft,
  type AuthoringHeader,
  type AuthoringState,
} from '../components/authoring/question-scaffold';

const IMAGE_LIMITS = {
  maxBytes: QUESTION_IMAGE_MAX_BYTES,
  accept: QUESTION_IMAGE_ACCEPTED_TYPES,
};

const PREVIEW_DEBOUNCE_MS = 600;

/** A Mac prints Cmd where every other keyboard prints Ctrl; the editor answers to both. */
const MOD_KEY = navigator.userAgent.includes('Mac') ? 'Cmd' : 'Ctrl';

const startingHeader = (): AuthoringHeader => ({
  subjectId: '',
  topicId: '',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: '',
});

interface Saved {
  header: AuthoringHeader;
  state: AuthoringState;
  language: QuestionLanguage;
  written: number;
}

export function AuthoringEditorPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { identity } = useAuth();
  const storageKey = `${STORAGE_KEYS.AUTHORING_DRAFT}.${identity?.id ?? ''}`;

  const restored = useMemo(() => restore(storageKey), [storageKey]);
  const [header, setHeader] = useState<AuthoringHeader>(restored?.header ?? startingHeader());
  const [state, setState] = useState<AuthoringState>(restored?.state ?? emptyState());
  const [language, setLanguage] = useState<QuestionLanguage>(
    restored?.language ?? DEFAULT_LANGUAGE,
  );
  const [written, setWritten] = useState(restored?.written ?? 0);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  // Bumped whenever the box must be rebuilt: a language, a type, or a question loaded into it.
  const [boxVersion, setBoxVersion] = useState(0);

  const fullscreen = useFullscreen();
  // The exit count when focus was asked for: Escape and F11 raise it, so leaving is derived.
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const immersive = focusedAt !== null && fullscreen.exits === focusedAt;
  useWorkspace(immersive);

  const editing = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, id],
    queryFn: () => api.admin.authoring.detail(id!),
    enabled: Boolean(id),
  });

  const loadedId = useRef<string | null>(null);
  useEffect(() => {
    const question = editing.data;
    if (!question || loadedId.current === question.id) return;
    loadedId.current = question.id;
    setHeader(headerOf(question));
    setState(stateOf(question));
    setLanguage(DEFAULT_LANGUAGE);
    setBoxVersion((version) => version + 1);
  }, [editing.data]);

  // A closed tab loses nothing, and nothing half-written reaches the bank: only a save writes a row.
  useEffect(() => {
    if (id) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ header, state, language, written }));
  }, [id, storageKey, header, state, language, written]);

  const draft = useMemo(() => toDraft(state, header), [state, header]);
  const issues = useChecked(draft, header);
  const missing = LANGUAGE_ORDER.filter(
    (code) => code !== DEFAULT_LANGUAGE && !hasText(state.content[code].stem),
  );
  const checks = useMemo(
    () =>
      checksFor(
        state,
        issues,
        missing.map((code) => LANGUAGE_LABELS[code]),
        duplicate,
      ),
    [state, issues, missing, duplicate],
  );

  const upload = useCallback(async (file: File) => api.admin.questions.uploadImage(file), []);

  const save = useMutation({
    meta: { success: id ? 'Question saved.' : 'Question saved. Next one.' },
    mutationFn: () =>
      id ? api.admin.authoring.update(id, draft) : api.admin.authoring.create(draft),
    onSuccess: async (result) => {
      setDuplicate(result.duplicateOf?.stemPreview ?? null);
      if (!id) {
        // The header survives: the next fifty questions are the same subject at the same level.
        setState(emptyState(state.type));
        setWritten((count) => count + 1);
        setBoxVersion((version) => version + 1);
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
    },
  });

  const blocking = issues.length > 0;
  const readOnly = Boolean(id) && editing.data?.status !== QUESTION_STATUS.DRAFT;
  const canSave = !blocking && !readOnly && !save.isPending;

  const cycleLanguage = useCallback(() => {
    setLanguage((current) => {
      const at = LANGUAGE_ORDER.indexOf(current);
      return LANGUAGE_ORDER[(at + 1) % LANGUAGE_ORDER.length]!;
    });
    setBoxVersion((version) => version + 1);
  }, []);

  const switchLanguage = useCallback((next: QuestionLanguage) => {
    setLanguage(next);
    setBoxVersion((version) => version + 1);
  }, []);

  const onRegions = useCallback(
    (regions: ScaffoldRegion[]) => setState((current) => stateFrom(current, language, regions)),
    [language],
  );

  const toggleFocus = () => {
    if (immersive) {
      setFocusedAt(null);
      void fullscreen.exit();
      return;
    }
    setFocusedAt(fullscreen.exits);
    void fullscreen.enter();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AuthoringHeaderBar
        header={header}
        state={state}
        language={language}
        counter={id ? 'Editing' : `Question ${written + 1}`}
        disabled={readOnly}
        onHeaderChange={setHeader}
        onStateChange={(next) => {
          setState(next);
          setBoxVersion((version) => version + 1);
        }}
        onLanguageChange={switchLanguage}
        actions={
          <>
            <Button type="button" size="sm" disabled={!canSave} onClick={() => save.mutate()}>
              <Save aria-hidden />
              {id ? 'Save' : 'Save and next'}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={immersive ? 'Leave full screen' : 'Full screen'}
                  onClick={toggleFocus}
                >
                  {immersive ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{immersive ? 'Leave full screen' : 'Full screen'}</TooltipContent>
            </Tooltip>
          </>
        }
      />

      {id && editing.isPending ? (
        <LoadingState>Loading the question</LoadingState>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          <section className="flex min-h-0 flex-col border-border lg:border-r">
            <PanelHeading title="Editor" />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {readOnly ? (
                <div className="p-4">
                  <Alert variant="info">
                    This question has left review. Changing it now belongs to the question bank.
                  </Alert>
                </div>
              ) : null}

              <ScaffoldEditor
                aria-label="Question"
                regions={regionsFor(state, language)}
                docKey={`${id ?? 'new'}:${language}:${state.type}:${boxVersion}`}
                onChange={onRegions}
                repeat={state.type === QUESTION_TYPE.SINGLE_MCQ ? OPTION_REPEAT : undefined}
                onSave={() => {
                  if (canSave) save.mutate();
                }}
                onCycleLanguage={cycleLanguage}
                onUploadImage={upload}
                imageLimits={IMAGE_LIMITS}
                disabled={readOnly}
                lang={language}
                className="flex-1 rounded-none border-0 shadow-none"
              />
            </div>
          </section>

          <section className="flex min-h-0 flex-col">
            <PanelHeading title="Preview and validation" />
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <AuthoringPreview state={state} language={language} />
              <AuthoringChecks checks={checks} />
            </div>
          </section>
        </div>
      )}

      <Legend language={language} />
    </div>
  );
}

function PanelHeading({ title }: Readonly<{ title: string }>) {
  return (
    <h2 className="flex-none border-b border-border bg-surface px-4 py-2 text-sm font-semibold">
      {title}
    </h2>
  );
}

/** A keyboard-only tool says which keys, once, where it does not cost the box any room. */
function Legend({ language }: Readonly<{ language: QuestionLanguage }>) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface px-4 py-2 text-xs text-muted-foreground">
      <Shortcut keys={['↑', '↓']}>move</Shortcut>
      <Shortcut keys={['Enter']}>next</Shortcut>
      <Shortcut keys={[MOD_KEY, 'Enter']}>save and next</Shortcut>
      <Shortcut keys={['$…$']}>maths</Shortcut>
      <Shortcut keys={[MOD_KEY, 'V']}>paste an image</Shortcut>
      <Shortcut keys={['Alt', 'L']}>{LANGUAGE_LABELS[language]}</Shortcut>
    </div>
  );
}

function Shortcut({
  keys,
  children,
}: Readonly<{ keys: readonly string[]; children: React.ReactNode }>) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, index) => (
        <span key={`${key}:${index}`} className="flex items-center gap-1">
          {index > 0 ? <span aria-hidden>+</span> : null}
          <Kbd>{key}</Kbd>
        </span>
      ))}
      <span className="ml-1">{children}</span>
    </span>
  );
}

/** The rules the save and the sheet are judged by, debounced so the panel settles as you type. */
function useChecked(draft: QuestionDraft, header: AuthoringHeader) {
  const [issues, setIssues] = useState<ReturnType<typeof validateQuestion>>([]);

  useEffect(() => {
    const timer = setTimeout(
      () => setIssues(validateQuestion(draft, taxonomyFor(header), mathErrorIn)),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [draft, header]);

  return issues;
}

function restore(key: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
