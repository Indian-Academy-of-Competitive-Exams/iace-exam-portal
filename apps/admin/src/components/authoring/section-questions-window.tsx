import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Keyboard, Save, X } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  PAGE_SIZE_MAX,
  validateQuestion,
  type AssignmentWithTest,
  type QuestionDetail,
  type QuestionLanguage,
  type QuestionSummary,
} from '@iace/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  ScrollWindow,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  mathErrorIn,
} from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { AuthoringHeaderBar } from './authoring-header-bar';
import { QuestionPanes } from './question-panes';
import {
  SCRIPT_OF,
  emptyState,
  headerOf,
  stateFrom,
  stateOf,
  taxonomyFor,
  toDraft,
  type AuthoringHeader,
  type AuthoringState,
} from './question-scaffold';
import { useChecked, useDuplicate } from './use-question-checks';

/** What the box says. Held only while it differs from the saved question: that is what "unsaved" means. */
interface Edit {
  header: AuthoringHeader;
  state: AuthoringState;
}

/** How a block is being looked at — never a change to the question. */
interface View {
  language: QuestionLanguage;
  /** Bumped when the box must be rebuilt: a language, a type, or an option count changed. */
  box: number;
}

const FIRST_VIEW: View = { language: DEFAULT_LANGUAGE, box: 0 };

const BLANK_DRAFT = toDraft(emptyState(), {
  subjectId: '',
  topicId: '',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: '',
});

const detailKey = (id: string) => [...QUERY_KEYS.AUTHORING, id] as const;

const baseOf = (question: QuestionDetail): Edit => ({
  header: headerOf(question),
  state: stateOf(question),
});

const sameEdit = (a: Edit, b: Edit): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every question written for a section, oldest first, however many pages that takes. */
async function sectionQuestions(assignmentId: string): Promise<QuestionSummary[]> {
  const all: QuestionSummary[] = [];
  for (let page = 1; ; page += 1) {
    const read = await api.admin.authoring.history({
      assignmentId: [assignmentId],
      page,
      pageSize: PAGE_SIZE_MAX,
    });
    all.push(...read.items);
    if (all.length >= read.total || read.items.length === 0) return all.reverse();
  }
}

/** Every question of a section in one scroll, each editable where it stands; the header follows the one in view. */
export function SectionQuestionsWindow({
  assignment,
  open,
  onOpenChange,
  startAt,
}: Readonly<{
  assignment: AssignmentWithTest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The question to land on; null opens at the first. */
  startAt: string | null;
}>) {
  const queryClient = useQueryClient();
  const written = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, 'section', assignment.id, 'all'],
    queryFn: () => sectionQuestions(assignment.id),
    enabled: open,
  });
  const ids = useMemo(() => (written.data ?? []).map((question) => question.id), [written.data]);

  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [views, setViews] = useState<Record<string, View>>({});
  const [active, setActive] = useState(0);
  const [scrollTo, setScrollTo] = useState<{ key: string } | null>(null);
  const [romanised, setRomanised] = useState(true);
  const [discarding, setDiscarding] = useState(false);

  // Lands once the list is known: the first render has no rows to scroll to.
  const [landed, setLanded] = useState(false);
  if (open && !landed && ids.length > 0) {
    setLanded(true);
    if (startAt && ids.includes(startAt)) setScrollTo({ key: startAt });
  }
  if (!open && landed) setLanded(false);

  const activeId = ids[active] ?? '';
  const activeDetail = useQuery({
    queryKey: detailKey(activeId),
    queryFn: () => api.admin.authoring.detail(activeId),
    enabled: activeId !== '',
  });
  const shown = edits[activeId] ?? (activeDetail.data ? baseOf(activeDetail.data) : null);

  const edit = useCallback(
    (id: string, change: (current: Edit) => Edit) => {
      setEdits((all) => {
        const cached = queryClient.getQueryData<QuestionDetail>(detailKey(id));
        if (!cached) return all;
        const base = baseOf(cached);
        const next = change(all[id] ?? base);
        // Back to what is saved, whether typed back or normalised by the editor: nothing is pending.
        if (sameEdit(next, base)) {
          const { [id]: _same, ...rest } = all;
          return rest;
        }
        return { ...all, [id]: next };
      });
    },
    [queryClient],
  );
  const view = useCallback((id: string, change: (current: View) => View) => {
    setViews((all) => ({ ...all, [id]: change(all[id] ?? FIRST_VIEW) }));
  }, []);
  const rebuild = (id: string) => view(id, (current) => ({ ...current, box: current.box + 1 }));

  const save = useMutation({
    meta: { success: 'Question saved.' },
    mutationFn: ({ id, held }: { id: string; held: Edit }) =>
      api.admin.authoring.update(id, {
        ...toDraft(held.state, held.header),
        // Refused if it moved since this window read it: an edit made elsewhere is not overwritten.
        expectedUpdatedAt: queryClient.getQueryData<QuestionDetail>(detailKey(id))?.updatedAt,
      }),
    onSuccess: async (_result, { id }) => {
      setEdits(({ [id]: _saved, ...rest }) => rest);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
    },
  });

  const activeDraft = useMemo(() => (shown ? toDraft(shown.state, shown.header) : null), [shown]);
  const duplicate = useDuplicate(activeDraft ?? BLANK_DRAFT, activeId);
  const issues = useMemo(
    () =>
      activeDraft && shown
        ? validateQuestion(activeDraft, taxonomyFor(shown.header), mathErrorIn)
        : [],
    [activeDraft, shown],
  );

  const dirty = Object.keys(edits);
  const canSave = activeId in edits && issues.length === 0 && duplicate === null && !save.isPending;
  const saveOne = (id: string) => {
    const held = edits[id];
    if (held) save.mutate({ id, held });
  };

  const close = (next: boolean) => {
    if (!next && dirty.length > 0) {
      setDiscarding(true);
      return;
    }
    onOpenChange(next);
  };

  const step = (by: number) => {
    const target = ids[active + by];
    if (target) setScrollTo({ key: target });
  };

  const header = shown ? (
    <AuthoringHeaderBar
      header={shown.header}
      state={shown.state}
      subjectLocked={assignment.sectionSubjectId !== null}
      onHeaderChange={(next) => edit(activeId, (current) => ({ ...current, header: next }))}
      onStateChange={(next) => {
        edit(activeId, (current) => ({ ...current, state: next }));
        rebuild(activeId);
      }}
      lead={
        <>
          <span className="text-sm font-semibold tabular-nums">
            {`Question ${active + 1} of ${ids.length}`}
          </span>
          {activeId in edits ? <Badge variant="warning">Unsaved</Badge> : null}
          {written.data?.[active]?.releasedAt ? <Badge variant="success">Handed over</Badge> : null}
        </>
      }
      actions={
        <WindowActions
          language={(views[activeId] ?? FIRST_VIEW).language}
          romanised={romanised}
          canSave={canSave}
          saving={save.isPending}
          atFirst={active === 0}
          atLast={active >= ids.length - 1}
          onRomanised={() => setRomanised((on) => !on)}
          onStep={step}
          onSave={() => saveOne(activeId)}
          onClose={() => close(false)}
        />
      }
    />
  ) : (
    <div className="flex h-12 items-center px-4">
      <Skeleton className="h-6 w-80" />
    </div>
  );

  return (
    <>
      <ScrollWindow
        open={open}
        onOpenChange={close}
        title={`${assignment.sectionName} questions`}
        header={header}
        itemKeys={ids}
        onActiveChange={setActive}
        scrollTo={scrollTo}
        renderItem={(index) => {
          const id = ids[index] ?? '';
          return (
            <QuestionBlock
              id={id}
              held={edits[id]}
              view={views[id] ?? FIRST_VIEW}
              romanised={romanised}
              onEdit={(change) => edit(id, change)}
              onView={(change) => view(id, change)}
              onSave={() => saveOne(id)}
            />
          );
        }}
      />

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard unsaved changes?"
        description={`${dirty.length} ${dirty.length === 1 ? 'question has' : 'questions have'} changes that are not saved. Closing throws them away.`}
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setDiscarding(false);
          setEdits({});
          onOpenChange(false);
        }}
      />
    </>
  );
}

/** One question in the scroll: its box and its preview, exactly as the section editor lays them out. */
function QuestionBlock({
  id,
  held,
  view,
  romanised,
  onEdit,
  onView,
  onSave,
}: Readonly<{
  id: string;
  held: Edit | undefined;
  view: View;
  romanised: boolean;
  onEdit: (change: (current: Edit) => Edit) => void;
  onView: (change: (current: View) => View) => void;
  onSave: () => void;
}>) {
  const detail = useQuery({
    queryKey: detailKey(id),
    queryFn: () => api.admin.authoring.detail(id),
  });

  if (!detail.data) {
    return (
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  return (
    <LoadedBlock
      id={id}
      shown={held ?? baseOf(detail.data)}
      view={view}
      romanised={romanised}
      onEdit={onEdit}
      onView={onView}
      onSave={onSave}
    />
  );
}

function LoadedBlock({
  id,
  shown,
  view,
  romanised,
  onEdit,
  onView,
  onSave,
}: Readonly<{
  id: string;
  shown: Edit;
  view: View;
  romanised: boolean;
  onEdit: (change: (current: Edit) => Edit) => void;
  onView: (change: (current: View) => View) => void;
  onSave: () => void;
}>) {
  const draft = useMemo(() => toDraft(shown.state, shown.header), [shown]);
  const { checks } = useChecked(draft, shown.header, shown.state, null);

  const switchTo = (language: QuestionLanguage) =>
    onView((current) => ({ language, box: current.box + 1 }));

  return (
    <QuestionPanes
      flow
      questionId={id}
      state={shown.state}
      language={view.language}
      romanised={romanised}
      canSave
      boxVersion={view.box}
      checks={checks}
      onRegions={(regions: ScaffoldRegion[]) =>
        onEdit((current) => ({
          ...current,
          state: stateFrom(current.state, view.language, regions),
        }))
      }
      onCycleLanguage={() => {
        const at = LANGUAGE_ORDER.indexOf(view.language);
        switchTo(LANGUAGE_ORDER[(at + 1) % LANGUAGE_ORDER.length] ?? view.language);
      }}
      onLanguageChange={switchTo}
      onSave={onSave}
    />
  );
}

/** The header's right-hand end: move, save the question in view, close. */
function WindowActions({
  language,
  romanised,
  canSave,
  saving,
  atFirst,
  atLast,
  onRomanised,
  onStep,
  onSave,
  onClose,
}: Readonly<{
  language: QuestionLanguage;
  romanised: boolean;
  canSave: boolean;
  saving: boolean;
  atFirst: boolean;
  atLast: boolean;
  onRomanised: () => void;
  onStep: (by: number) => void;
  onSave: () => void;
  onClose: () => void;
}>) {
  return (
    <>
      <IconAction label="Previous question" disabled={atFirst} onClick={() => onStep(-1)}>
        <ChevronUp aria-hidden />
      </IconAction>
      <IconAction label="Next question" disabled={atLast} onClick={() => onStep(1)}>
        <ChevronDown aria-hidden />
      </IconAction>
      {SCRIPT_OF[language] ? (
        <IconAction
          label={
            romanised
              ? `Typing dhanyavaad writes it in ${LANGUAGE_LABELS[language]}`
              : 'Roman letters stay as they are typed'
          }
          pressed={romanised}
          onClick={onRomanised}
        >
          <Keyboard aria-hidden />
        </IconAction>
      ) : null}
      <Button type="button" size="sm" disabled={!canSave} loading={saving} onClick={onSave}>
        <Save aria-hidden />
        Save
      </Button>
      <IconAction label="Close" onClick={onClose}>
        <X aria-hidden />
      </IconAction>
    </>
  );
}

function IconAction({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: Readonly<{
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? 'default' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
