import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keyboard, Maximize2, Minimize2, Save } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
  hasText,
  instituteDayLabel,
  validateQuestion,
  type AssignmentWithTest,
  type AuthoringSaveResult,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionLanguage,
} from '@iace/contracts';
import { useFullscreen, useWorkspace } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  Kbd,
  LoadingState,
  SegmentedControl,
  StatRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  INDIC_SCRIPTS,
  mathErrorIn,
  type IndicScript,
} from '@iace/ui';
import { ScaffoldEditor, type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { api } from '../lib/api';
import { QUERY_KEYS, STORAGE_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { AuthoringHeaderBar } from '../components/authoring/authoring-header-bar';
import { SectionWorkButton } from '../components/authoring/section-work-sheet';
import { SectionThreadButton } from '../components/section-thread';
import {
  AuthoringChecks,
  AuthoringPreview,
  type Check,
} from '../components/authoring/authoring-preview';
import { checksFor } from '../components/authoring/authoring-checks';
import {
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

/** Longer than the preview's: this one leaves the machine, and a half-typed stem matches nothing. */
const DUPLICATE_DEBOUNCE_MS = 900;

/** A Mac prints Cmd where every other keyboard prints Ctrl; the editor answers to both. */
const MOD_KEY = navigator.userAgent.includes('Mac') ? 'Cmd' : 'Ctrl';

const uploadImage = async (file: File) => api.admin.questions.uploadImage(file);

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
  /** The typist's own setting, kept because it is about their keyboard and not this question. */
  romanised: boolean;
}

/** The section a scoped editor writes for, and why the panes are not its to open yet. */
interface ScopedSection {
  scoped: string;
  section: AssignmentWithTest | null;
  loading: boolean;
  refused: boolean;
}

/** Which script a language is written in. English is typed as it is read. */
const SCRIPT_OF: Readonly<Partial<Record<QuestionLanguage, IndicScript>>> = {
  hi: INDIC_SCRIPTS.DEVANAGARI,
  te: INDIC_SCRIPTS.TELUGU,
};

export function AuthoringEditorPage() {
  const { id, assignmentId } = useParams<{ id?: string; assignmentId?: string }>();
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
  const editing = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, id],
    queryFn: () => api.admin.authoring.detail(editingId),
    enabled: editingId !== '',
  });
  const assignment = useTypistAssignment(assignmentId);
  const heldElsewhere = useSectionHolder(assignment.section, identity?.id);
  const sectionSubjectId = assignment.section?.sectionSubjectId ?? null;
  useSectionSubject(editingId === '' ? sectionSubjectId : null, setHeader);

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

  const save = useSaveQuestion(editingId, draft, assignment.scoped, () => {
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

  const gate = editorGate(editing.isPending && editingId !== '', assignment);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AuthoringHeaderBar
        header={header}
        state={state}
        subjectLocked={sectionSubjectId !== null}
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
            canSave={canSave}
            saveLabel={id ? 'Save' : 'Save and next'}
            onSave={() => save.mutate()}
            onRomanised={() => setRomanised((on) => !on)}
            onFocus={focus.toggle}
          />
        }
      />

      {assignment.section ? <AssignmentContext assignment={assignment.section} /> : null}

      {heldElsewhere ? (
        <Alert variant="warning" className="mx-4 mt-4">
          {`${heldElsewhere.fullName ?? 'Another admin'} is editing this section. Their changes have to land first.`}
        </Alert>
      ) : null}

      {gate ?? (
        <EditorPanes
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

      <Legend language={language} />
    </div>
  );
}

/** Nothing to edit yet, or nothing they may edit: what stands in for the panes. */
function editorGate(loadingQuestion: boolean, assignment: ScopedSection): React.ReactNode {
  if (loadingQuestion) return <LoadingState>Loading the question</LoadingState>;
  if (assignment.loading) return <LoadingState>Loading the assignment</LoadingState>;
  if (assignment.refused) {
    return (
      <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This section is not assigned to you" />
    );
  }
  return null;
}

/** The two columns the typist works in: what they are writing, and what it looks like. */
function EditorPanes({
  questionId,
  state,
  language,
  romanised,
  canSave,
  boxVersion,
  checks,
  onRegions,
  onCycleLanguage,
  onLanguageChange,
  onSave,
}: Readonly<{
  questionId: string;
  state: AuthoringState;
  language: QuestionLanguage;
  romanised: boolean;
  canSave: boolean;
  boxVersion: number;
  checks: readonly Check[];
  onRegions: (regions: ScaffoldRegion[]) => void;
  onCycleLanguage: () => void;
  onLanguageChange: (next: QuestionLanguage) => void;
  onSave: () => void;
}>) {
  const script = romanised ? (SCRIPT_OF[language] ?? null) : null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
      <section className="flex min-h-0 flex-col border-border lg:border-r">
        <PanelHeading
          action={
            <SegmentedControl
              value={language}
              onChange={(value) => onLanguageChange(value as QuestionLanguage)}
              aria-label="Language"
              items={LANGUAGE_ORDER.map((code) => ({
                value: code,
                label: code.toUpperCase(),
                name: LANGUAGE_LABELS[code],
              }))}
            />
          }
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ScaffoldEditor
            aria-label="Question"
            regions={regionsFor(state, language)}
            docKey={`${questionId || 'new'}:${language}:${state.type}:${boxVersion}`}
            onChange={onRegions}
            onSave={() => {
              if (canSave) onSave();
            }}
            onCycleLanguage={onCycleLanguage}
            onUploadImage={uploadImage}
            imageLimits={IMAGE_LIMITS}
            lang={language}
            script={script}
            className="flex-1 rounded-none border-0 shadow-none"
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <PanelHeading title="Preview and validation" />
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <AuthoringPreview state={state} language={language} />
          <AuthoringChecks checks={checks} />
        </div>
      </section>
    </div>
  );
}

/** The header's right-hand end. Its own component, so the page reads as a page. */
function EditorActions({
  language,
  romanised,
  immersive,
  canSave,
  saveLabel,
  onSave,
  onRomanised,
  onFocus,
}: Readonly<{
  language: QuestionLanguage;
  romanised: boolean;
  immersive: boolean;
  canSave: boolean;
  saveLabel: string;
  onSave: () => void;
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

      <Button type="button" size="sm" disabled={!canSave} onClick={onSave}>
        <Save aria-hidden />
        {saveLabel}
      </Button>

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

/** The section a scoped editor is writing for: its target, and its mix when the test sets one. */
function AssignmentContext({ assignment }: Readonly<{ assignment: AssignmentWithTest }>) {
  const remaining = Math.max(assignment.sectionQuestionCount - assignment.writtenCount, 0);
  const mix = assignment.sectionMix;

  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border bg-muted/40 px-4 py-2">
      <div className="min-w-0">
        <TruncatedText className="text-sm font-medium">{assignment.sectionName}</TruncatedText>
        <TruncatedText className="text-xs text-muted-foreground">
          {assignment.testTitle ?? 'Untitled test'}
        </TruncatedText>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <SectionWorkButton assignment={assignment} />
        {/* The other half of the conversation: the reader raises things here, and answers here. */}
        <SectionThreadButton
          testId={assignment.testId}
          sectionId={assignment.baseConfigSectionId}
          canWrite
        />
        <StatRow
          className="w-auto"
          label="Written"
          value={`${assignment.writtenCount} / ${assignment.sectionQuestionCount}`}
        />
        <StatRow className="w-auto" label="Remaining" value={remaining} />
        <StatRow
          className="w-auto"
          label="Due"
          value={instituteDayLabel(assignment.dueAt) ?? 'No due date'}
        />
        {mix ? (
          <StatRow
            className="w-auto"
            label="Mix"
            value={`${mix.LOW} low · ${mix.MEDIUM} medium · ${mix.HIGH} high`}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A pane whose content names itself takes no title; the bar stays so both panes line up. */
function PanelHeading({ title, action }: Readonly<{ title?: string; action?: React.ReactNode }>) {
  return (
    <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border bg-surface px-4">
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
      {action}
    </div>
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

/** Escape and F11 raise the exit count, so leaving full screen is derived, not listened for. */
function useFocusMode() {
  const fullscreen = useFullscreen();
  const [focusedAt, setFocusedAt] = useState<number | null>(null);
  const immersive = focusedAt !== null && fullscreen.exits === focusedAt;
  useWorkspace(immersive);

  const toggle = () => {
    if (immersive) {
      setFocusedAt(null);
      void fullscreen.exit();
      return;
    }
    setFocusedAt(fullscreen.exits);
    void fullscreen.enter();
  };

  return { immersive, toggle };
}

/** Their own sections, so a URL naming somebody else's is refused rather than opened empty. */
function useTypistAssignment(scoped = ''): ScopedSection {
  const held = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'one', scoped],
    queryFn: () => api.admin.assignments.one(scoped),
    enabled: scoped !== '',
    retry: false,
  });
  const section = held.data ?? null;

  return {
    scoped,
    section,
    loading: scoped !== '' && held.isPending,
    refused: scoped !== '' && !held.isPending && section === null,
  };
}

/** Who else is in this section right now — read once on load, so the warning lands before the work. */
function useSectionHolder(section: AssignmentWithTest | null, adminId: string | undefined) {
  const testId = section?.testId ?? '';
  const sectionId = section?.baseConfigSectionId ?? '';
  const lock = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'lock', testId, sectionId],
    queryFn: () => api.admin.assignments.sectionLock(testId, sectionId),
    enabled: testId !== '' && sectionId !== '',
  });

  const editingBy = lock.data?.editingBy ?? null;
  return editingBy && editingBy.adminId !== adminId ? editingBy : null;
}

/** Saving is all the server hears: a new question, or the draft this editor was opened on. */
function useSaveQuestion(
  questionId: string,
  draft: QuestionDraft,
  assignmentId: string,
  onSaved: (result: AuthoringSaveResult) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { success: questionId ? 'Question saved.' : 'Question saved. Next one.' },
    mutationFn: () =>
      questionId
        ? api.admin.authoring.update(questionId, draft)
        : api.admin.authoring.create({ ...draft, assignmentId: assignmentId || null }),
    onSuccess: async (result) => {
      onSaved(result);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
      if (assignmentId) await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
    },
  });
}

/** The section names the subject, so it wins over whatever the last batch left in the draft. */
function useSectionSubject(
  subjectId: string | null,
  setHeader: React.Dispatch<React.SetStateAction<AuthoringHeader>>,
) {
  useEffect(() => {
    if (subjectId === null) return;
    setHeader((current) =>
      current.subjectId === subjectId ? current : { ...current, subjectId, topicId: '' },
    );
  }, [subjectId, setHeader]);
}

/** The fetched question fills the boxes once; a refetch must not overwrite what is being typed. */
function useFilledOnce(
  question: QuestionDetail | undefined,
  fill: (question: QuestionDetail) => void,
) {
  const filledId = useRef<string | null>(null);

  useEffect(() => {
    if (!question || filledId.current === question.id) return;
    filledId.current = question.id;
    fill(question);
  }, [question, fill]);
}

/** A closed tab loses nothing, and nothing half-written reaches the bank: only a save writes a row. */
function usePersistedDraft(key: string, enabled: boolean, saved: Saved) {
  useEffect(() => {
    if (!enabled) return;
    window.localStorage.setItem(key, JSON.stringify(saved));
  }, [key, enabled, saved]);
}

/** Asked of the draft on screen, not of the row a save would otherwise have left behind. */
function useDuplicate(draft: QuestionDraft, editingId: string): string | null {
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
function useChecked(
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

/** What a reopened tab starts from: the draft it left, over the blanks a first visit gets. */
function restore(key: string): Saved {
  const blank: Saved = {
    header: startingHeader(),
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
