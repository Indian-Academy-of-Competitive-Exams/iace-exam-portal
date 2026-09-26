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
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  mathErrorIn,
} from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { AuthoringHeaderBar } from './authoring-header-bar';
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
}: Readonly<{
  source: QuestionsSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The question to land on; null opens at the first. */
  startAt: string | null;
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

  const header = shown ? (
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
          language={(views[activeKey] ?? FIRST_VIEW).language}
          romanised={romanised}
          canSave={canSave}
          saving={save.isPending}
          atFirst={active === 0}
          atLast={active >= keys.length - 1}
          onRomanised={() => setRomanised((on) => !on)}
          onStep={step}
          onSave={() => saveOne(activeKey)}
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
        title={source.title}
        header={header}
        itemKeys={keys}
        onActiveChange={setActive}
        scrollTo={scrollTo}
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
  return (
    <LoadedBlock
      questionKey={questionKey}
      shown={held ?? base.data}
      view={view}
      romanised={romanised}
      onEdit={onEdit}
      onView={onView}
      onSave={onSave}
    />
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
