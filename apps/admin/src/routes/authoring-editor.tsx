import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Languages, Save } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
  QUESTION_STATUS,
  QUESTION_TYPE,
  previewTextOf,
  validateQuestion,
  type QuestionDraft,
  type QuestionLanguage,
  type ValidationIssue,
} from '@iace/contracts';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  LoadingState,
  PageFrame,
  PageHeader,
  RichContent,
  SectionHeading,
  mathErrorIn,
} from '@iace/ui';
import { ScaffoldEditor, type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, STORAGE_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { AuthoringHeaderBar } from '../components/authoring/authoring-header-bar';
import {
  OPTION_REPEAT,
  emptyState,
  headerOf,
  optionLabel,
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

const startingHeader = (): AuthoringHeader => ({
  subjectId: '',
  topicId: '',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: [],
});

interface Saved {
  header: AuthoringHeader;
  state: AuthoringState;
  language: QuestionLanguage;
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
  const [duplicate, setDuplicate] = useState<{ id: string; stemPreview: string } | null>(null);
  // Bumped whenever the box must be rebuilt: a language, a type, or a question loaded into it.
  const [boxVersion, setBoxVersion] = useState(0);

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
    window.localStorage.setItem(storageKey, JSON.stringify({ header, state, language }));
  }, [id, storageKey, header, state, language]);

  const tags = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, 'tags'],
    queryFn: () => api.admin.authoring.tags(),
  });

  const draft = useMemo(() => toDraft(state, header), [state, header]);
  const issues = useChecked(draft, header);

  const upload = useCallback(async (file: File) => api.admin.questions.uploadImage(file), []);

  const save = useMutation({
    meta: { success: id ? 'Question saved.' : 'Question saved. Next one.' },
    mutationFn: () =>
      id ? api.admin.authoring.update(id, draft) : api.admin.authoring.create(draft),
    onSuccess: async (result) => {
      setDuplicate(result.duplicateOf);
      if (!id) {
        // The header survives: the next fifty questions are the same subject at the same level.
        setState(emptyState(state.type));
        setBoxVersion((version) => version + 1);
        window.localStorage.removeItem(storageKey);
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
    },
  });

  const blocking = issues.length > 0;
  const readOnly = Boolean(id) && editing.data?.status !== QUESTION_STATUS.DRAFT;

  const cycleLanguage = useCallback(() => {
    setLanguage((current) => {
      const next = LANGUAGE_ORDER[(LANGUAGE_ORDER.indexOf(current) + 1) % LANGUAGE_ORDER.length]!;
      return next;
    });
    setBoxVersion((version) => version + 1);
  }, []);

  const onRegions = useCallback(
    (regions: ScaffoldRegion[]) => setState((current) => stateFrom(current, language, regions)),
    [language],
  );

  const pageHeader = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title={id ? 'Edit question' : 'New question'}
      meta={editing.data?.questionCode ?? undefined}
      action={
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={cycleLanguage}>
            <Languages aria-hidden />
            {LANGUAGE_LABELS[language]}
          </Button>
          <Button
            type="button"
            disabled={blocking || save.isPending || readOnly}
            onClick={() => save.mutate()}
          >
            <Save aria-hidden />
            {id ? 'Save' : 'Save and next'}
          </Button>
        </div>
      }
    />
  );

  if (id && editing.isPending) {
    return (
      <PageFrame header={pageHeader}>
        <LoadingState>Loading the question</LoadingState>
      </PageFrame>
    );
  }

  return (
    <PageFrame header={pageHeader}>
      <div className="space-y-4">
        <AuthoringHeaderBar
          header={header}
          state={state}
          tagOptions={tags.data ?? []}
          disabled={readOnly}
          onHeaderChange={setHeader}
          onStateChange={(next) => {
            setState(next);
            setBoxVersion((version) => version + 1);
          }}
        />

        {readOnly ? (
          <Alert variant="info">
            This question has left review. Changing it now belongs to the question bank.
          </Alert>
        ) : null}

        {duplicate ? (
          <Alert variant="warning">
            The bank already holds a question that reads the same: “{duplicate.stemPreview}”.
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <ScaffoldEditor
            aria-label="Question"
            regions={regionsFor(state, language)}
            docKey={`${id ?? 'new'}:${language}:${state.type}:${boxVersion}`}
            onChange={onRegions}
            repeat={state.type === QUESTION_TYPE.SINGLE_MCQ ? OPTION_REPEAT : undefined}
            onSave={() => {
              if (!blocking && !readOnly) save.mutate();
            }}
            onCycleLanguage={cycleLanguage}
            onUploadImage={upload}
            imageLimits={IMAGE_LIMITS}
            disabled={readOnly}
            lang={language}
          />

          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <Checks issues={issues} />
            <Preview state={state} language={language} />
          </aside>
        </div>
      </div>
    </PageFrame>
  );
}

/** The rules the save and the sheet are judged by, debounced so the panel settles as you type. */
function useChecked(draft: QuestionDraft, header: AuthoringHeader): ValidationIssue[] {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    const timer = setTimeout(
      () => setIssues(validateQuestion(draft, taxonomyFor(header), mathErrorIn)),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [draft, header]);

  return issues;
}

function Checks({ issues }: Readonly<{ issues: readonly ValidationIssue[] }>) {
  if (issues.length === 0) {
    return <Alert variant="success">Ready to save.</Alert>;
  }

  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <Alert key={`${issue.code}:${issue.field ?? ''}`} variant="danger">
          {issue.message}
        </Alert>
      ))}
    </div>
  );
}

function Preview({
  state,
  language,
}: Readonly<{ state: AuthoringState; language: QuestionLanguage }>) {
  const content = state.content[language];

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4">
      <SectionHeading title="Preview" />
      <RichContent html={content.stem} lang={language} />
      {state.type === QUESTION_TYPE.SINGLE_MCQ ? (
        <ol className="space-y-1">
          {content.options.map((option, index) => (
            <li key={optionLabel(index)} className="flex gap-2 text-sm">
              <span className="font-semibold tabular-nums">{optionLabel(index)}</span>
              <RichContent html={option} lang={language} />
            </li>
          ))}
        </ol>
      ) : null}
      <Badge variant="info">{previewTextOf(state.answer) || '—'}</Badge>
      <RichContent html={content.solution} lang={language} />
    </section>
  );
}

function restore(key: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
