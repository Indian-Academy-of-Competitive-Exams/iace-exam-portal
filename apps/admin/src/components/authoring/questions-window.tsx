import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Keyboard, Save, X } from 'lucide-react';
import {
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVEL,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  validateQuestion,
  type QuestionLanguage,
} from '@iace/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  ScrollWindow,
  SegmentedControl,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  mathErrorIn,
} from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { AuthoringHeaderBar } from './authoring-header-bar';
import { AuthoringPreview } from './authoring-preview';
import { QuestionPanes } from './question-panes';
import {
  SCRIPT_OF,
  emptyState,
  stateFrom,
  taxonomyFor,
  toDraft,
  type AuthoringHeader,
  type AuthoringState,
} from './question-scaffold';
import { useChecked, useDuplicate } from './use-question-checks';

/** What the box says. Held as an edit only while it differs from the saved one: that is what "unsaved" means. */
export interface Held {
  header: AuthoringHeader;
  state: AuthoringState;
  /** Whatever a save must still match on the server, carried untouched through every edit. */
  stamp?: string;
}

/** Where the window's questions come from, and where a saved one goes. */
export interface QuestionsSource {
  title: string;
  keys: readonly string[];
  /** How one question is read into the box; cached under its own key. */
  query: (key: string) => { queryKey: QueryKey; queryFn: () => Promise<Held> };
  /** The start of the header for the question in view: where it stands, and what will happen to it. */
  lead: (index: number) => React.ReactNode;
  subjectLocked: boolean;
  /** Only where a copy of a bank question refuses the save; an import row just becomes a duplicate. */
  checkDuplicates: boolean;
  save: (key: string, held: Held) => Promise<unknown>;
  /** Read, not edited: the moment has taken the section out of this viewer's hands. */
  locked?: boolean;
  /** Above the question, for what the reader should know before touching it. */
  notice?: (key: string) => React.ReactNode;
}

/** Where the window stands, for a panel beside it that can also move it. */
export interface WindowPosition {
  active: number;
  jump: (key: string) => void;
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

const sameHeld = (a: Held, b: Held): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every question of a source in one scroll, each editable where it stands; the header follows the one in view. */
export function QuestionsWindow({
  source,
  open,
  onOpenChange,
  startAt,
  aside,
}: Readonly<{
  source: QuestionsSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The question to land on; null opens at the first. */
  startAt: string | null;
  aside?: (position: WindowPosition) => React.ReactNode;
}>) {
  const queryClient = useQueryClient();
  const { keys } = source;

  const [edits, setEdits] = useState<Record<string, Held>>({});
  const [views, setViews] = useState<Record<string, View>>({});
  const [active, setActive] = useState(0);
  const [scrollTo, setScrollTo] = useState<{ key: string } | null>(null);
  const [romanised, setRomanised] = useState(true);
  const [discarding, setDiscarding] = useState(false);

  // Lands once the list is known: the first render has no rows to scroll to.
  const [landed, setLanded] = useState(false);
  if (open && !landed && keys.length > 0) {
    setLanded(true);
    setScrollTo(startAt && keys.includes(startAt) ? { key: startAt } : null);
  }
  if (!open && landed) setLanded(false);

  const activeKey = keys[active] ?? '';
  const activeBase = useQuery({ ...source.query(activeKey), enabled: activeKey !== '' });
  const shown = edits[activeKey] ?? activeBase.data ?? null;

  const edit = useCallback(
    (key: string, change: (current: Held) => Held) => {
      setEdits((all) => {
        const base = queryClient.getQueryData<Held>(source.query(key).queryKey);
        if (!base) return all;
        const next = change(all[key] ?? base);
        // Back to what is saved, whether typed back or normalised by the editor: nothing is pending.
        if (sameHeld(next, base)) {
          const { [key]: _same, ...rest } = all;
          return rest;
        }
        return { ...all, [key]: next };
      });
    },
    [queryClient, source],
  );
  const view = useCallback((key: string, change: (current: View) => View) => {
    setViews((all) => ({ ...all, [key]: change(all[key] ?? FIRST_VIEW) }));
  }, []);
  const rebuild = (key: string) => view(key, (current) => ({ ...current, box: current.box + 1 }));

  const save = useMutation({
    meta: { success: 'Question saved.' },
    mutationFn: ({ key, held }: { key: string; held: Held }) => source.save(key, held),
    onSuccess: (_result, { key }) => setEdits(({ [key]: _saved, ...rest }) => rest),
  });

  const activeDraft = useMemo(() => (shown ? toDraft(shown.state, shown.header) : null), [shown]);
  const duplicate = useDuplicate(
    source.checkDuplicates ? (activeDraft ?? BLANK_DRAFT) : BLANK_DRAFT,
    activeKey,
  );
  const issues = useMemo(
    () =>
      activeDraft && shown
        ? validateQuestion(activeDraft, taxonomyFor(shown.header), mathErrorIn)
        : [],
    [activeDraft, shown],
  );

  const dirty = Object.keys(edits);
  const canSave =
    activeKey in edits && issues.length === 0 && duplicate === null && !save.isPending;
  const saveOne = (key: string) => {
    const held = edits[key];
    if (held) save.mutate({ key, held });
  };

  const close = (next: boolean) => {
    if (!next && dirty.length > 0) {
      setDiscarding(true);
      return;
    }
    onOpenChange(next);
  };

  const step = (by: number) => {
    const target = keys[active + by];
    if (target) setScrollTo({ key: target });
  };

  const moving = {
    atFirst: active === 0,
    atLast: active >= keys.length - 1,
    onStep: step,
    onClose: () => close(false),
  };
  let header: React.ReactNode = (
    <div className="flex h-12 items-center px-4">
      <Skeleton className="h-6 w-80" />
    </div>
  );
  if (source.locked) {
    header = <LockedBar lead={source.lead(active)} actions={<WindowActions {...moving} />} />;
  } else if (shown) {
    header = (
      <AuthoringHeaderBar
        header={shown.header}
        state={shown.state}
        subjectLocked={source.subjectLocked}
        onHeaderChange={(next) => edit(activeKey, (current) => ({ ...current, header: next }))}
        onStateChange={(next) => {
          edit(activeKey, (current) => ({ ...current, state: next }));
          rebuild(activeKey);
        }}
        lead={
          <>
            {source.lead(active)}
            {activeKey in edits ? <Badge variant="warning">Unsaved</Badge> : null}
          </>
        }
        actions={
          <WindowActions
            {...moving}
            editing={{
              language: (views[activeKey] ?? FIRST_VIEW).language,
              romanised,
              canSave,
              saving: save.isPending,
              onRomanised: () => setRomanised((on) => !on),
              onSave: () => saveOne(activeKey),
            }}
          />
        }
      />
    );
  }

  return (
    <>
      <ScrollWindow
        open={open}
        onOpenChange={close}
        title={source.title}
        header={header}
        itemKeys={keys}
        onActiveChange={setActive}
        scrollTo={scrollTo}
        aside={aside?.({ active, jump: (key) => setScrollTo({ key }) })}
        renderItem={(index) => {
          const key = keys[index] ?? '';
          return (
            <QuestionBlock
              questionKey={key}
              source={source}
              held={edits[key]}
              view={views[key] ?? FIRST_VIEW}
              romanised={romanised}
              onEdit={(change) => edit(key, change)}
              onView={(change) => view(key, change)}
              onSave={() => saveOne(key)}
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
/** The bar a read-only window keeps: where the question stands, and how to move on. */
function LockedBar({
  lead,
  actions,
}: Readonly<{ lead: React.ReactNode; actions: React.ReactNode }>) {
  return (
    <div className="flex flex-none items-center gap-x-4 bg-surface px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">{lead}</div>
      {actions}
    </div>
  );
}

function QuestionBlock({
  questionKey,
  source,
  held,
  view,
  romanised,
  onEdit,
  onView,
  onSave,
}: Readonly<{
  questionKey: string;
  source: QuestionsSource;
  held: Held | undefined;
  view: View;
  romanised: boolean;
  onEdit: (change: (current: Held) => Held) => void;
  onView: (change: (current: View) => View) => void;
  onSave: () => void;
}>) {
  const base = useQuery(source.query(questionKey));

  if (!base.data) {
    return (
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const notice = source.notice?.(questionKey);
  if (source.locked) {
    return (
      <>
        {notice}
        <ReadBlock state={base.data.state} view={view} onView={onView} />
      </>
    );
  }
  return (
    <>
      {notice}
      <LoadedBlock
        questionKey={questionKey}
        shown={held ?? base.data}
        view={view}
        romanised={romanised}
        onEdit={onEdit}
        onView={onView}
        onSave={onSave}
      />
    </>
  );
}

/** A question as its reader will see it, one language at a time, with nothing to type into. */
function ReadBlock({
  state,
  view,
  onView,
}: Readonly<{
  state: AuthoringState;
  view: View;
  onView: (change: (current: View) => View) => void;
}>) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <SegmentedControl
        value={view.language}
        onChange={(value) =>
          onView((current) => ({ ...current, language: value as QuestionLanguage }))
        }
        aria-label="Language"
        items={LANGUAGE_ORDER.map((code) => ({
          value: code,
          label: code.toUpperCase(),
          name: LANGUAGE_LABELS[code],
        }))}
      />
      <AuthoringPreview state={state} language={view.language} />
    </div>
  );
}

function LoadedBlock({
  questionKey,
  shown,
  view,
  romanised,
  onEdit,
  onView,
  onSave,
}: Readonly<{
  questionKey: string;
  shown: Held;
  view: View;
  romanised: boolean;
  onEdit: (change: (current: Held) => Held) => void;
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
      questionId={questionKey}
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
/** Present only where the window edits; a read-only one moves and closes. */
interface Editing {
  language: QuestionLanguage;
  romanised: boolean;
  canSave: boolean;
  saving: boolean;
  onRomanised: () => void;
  onSave: () => void;
}

function WindowActions({
  editing,
  atFirst,
  atLast,
  onStep,
  onClose,
}: Readonly<{
  editing?: Editing;
  atFirst: boolean;
  atLast: boolean;
  onStep: (by: number) => void;
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
      {editing ? <EditingActions editing={editing} /> : null}
      <IconAction label="Close" onClick={onClose}>
        <X aria-hidden />
      </IconAction>
    </>
  );
}

function EditingActions({ editing }: Readonly<{ editing: Editing }>) {
  const { language, romanised, canSave, saving, onRomanised, onSave } = editing;
  return (
    <>
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
